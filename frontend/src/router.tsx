import { createBrowserRouter } from "react-router";
import { Login } from "@/pages/Login";
import { Signup } from "@/pages/Signup";
import Home from "@/pages/Home";
import { RequireAuth } from "@/components/RequireAuth";

export const router = createBrowserRouter([
  {
    path: "/",
    children: [
      { path: "login", element: <Login /> },
      { path: "signup", element: <Signup /> },
      {
        element: <RequireAuth />,
        children: [{ index: true, element: <Home /> }],
      },
    ],
  },
]);
