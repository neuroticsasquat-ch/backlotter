"""`entity_event_statement` is `entity_event_ids`, built once (NEU-2288).

The request path executes a statement built once per entity type with the id as bind
parameters; the builder still builds the whole tree with the id in it. These pin that the two
are one statement: rendered with their values inline, the SQL is identical, for each of the
three entity kinds a page lists cards for, and the same of the page query the endpoint runs,
against the query `get_entity_events` built inline before it was cached.
"""

from datetime import UTC, datetime
from uuid import UUID

import pytest
from sqlalchemy import select, tuple_
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import InvalidRequestError

from upmovies.app.follow_queries import (
    ENTITY_ID_TEXT_PARAM,
    entity_event_ids,
    entity_event_params,
    entity_event_statement,
)
from upmovies.catalog.models import Film
from upmovies.news.models import Event, EventSummary
from upmovies.news.visibility import feed_visible
from upmovies.public.service import _entity_events_page

DIALECT = postgresql.dialect()


def _inline(stmt) -> str:
    return str(stmt.compile(dialect=DIALECT, compile_kwargs={"literal_binds": True}))


@pytest.mark.parametrize(
    ("entity_type", "entity_id"),
    [("person", 987654), ("company", 876543), ("franchise", 765432)],
)
def test_the_bound_statement_renders_the_builders_sql(entity_type, entity_id):
    built = entity_event_ids(entity_type, entity_id)
    bound = entity_event_statement(entity_type).params(entity_event_params(entity_id))

    assert _inline(bound) == _inline(built)
    # The id really is a parameter of the bound statement, not baked in, or the comparison
    # above would pass for the one id the statement happened to be built with.
    assert str(entity_id) not in str(entity_event_statement(entity_type).compile(dialect=DIALECT))


def test_the_statement_is_built_once_per_type():
    assert entity_event_statement("person") is entity_event_statement("person")
    assert entity_event_statement("person") is not entity_event_statement("company")


def test_executing_without_the_id_fails_rather_than_selecting_another_entity():
    compiled = entity_event_statement("person").compile(dialect=DIALECT)

    with pytest.raises(InvalidRequestError, match="'entity_id'"):
        compiled.construct_params({ENTITY_ID_TEXT_PARAM: "1"})


CURSOR = (datetime(2026, 11, 13, 9, 7, tzinfo=UTC), UUID("0b6f3f7e-6a43-4d0e-9a35-5c3f4a1d2e10"))


def _page_as_it_was_built(entity_type, entity_id, limit, cursor):
    """`get_entity_events`' query as it was spelled inline, per request, before NEU-2288."""
    filters = [Event.id.in_(entity_event_ids(entity_type, entity_id)), *feed_visible()]
    if cursor is not None:
        filters.append(tuple_(Event.created_at, Event.id) < cursor)
    return (
        select(Event, EventSummary.summary, EventSummary.edited_at)
        .join(EventSummary, EventSummary.event_id == Event.id)
        .join(Film, Film.id == Event.film_id)
        .where(*filters)
        .order_by(Event.created_at.desc(), Event.id.desc())
        .limit(limit + 1)
    )


@pytest.mark.parametrize("cursor", [None, CURSOR], ids=["first page", "after a cursor"])
@pytest.mark.parametrize(
    ("entity_type", "entity_id"),
    [("person", 987654), ("company", 876543), ("franchise", 765432)],
)
def test_the_cached_page_query_renders_the_inline_one(entity_type, entity_id, cursor):
    params = {**entity_event_params(entity_id), "page_rows": 21}
    if cursor is not None:
        params["cursor_created_at"], params["cursor_event_id"] = cursor
    cached = _entity_events_page(entity_type, after_cursor=cursor is not None)

    assert _inline(cached.params(params)) == _inline(
        _page_as_it_was_built(entity_type, entity_id, 20, cursor)
    )
