import { createBrowserRouter } from "react-router";
import { Login } from "@/pages/Login";
import { Signup } from "@/pages/Signup";
import Home from "@/pages/Home";
import { AdminIngest } from "@/pages/AdminIngest";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireAdmin } from "@/components/RequireAdmin";
import { AppLayout } from "@/components/AppLayout";

export const router = createBrowserRouter([
  {
    path: "/",
    children: [
      { path: "login", element: <Login /> },
      { path: "signup", element: <Signup /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <Home /> },
              {
                element: <RequireAdmin />,
                children: [{ path: "admin/ingest", element: <AdminIngest /> }],
              },
            ],
          },
        ],
      },
    ],
  },
]);
