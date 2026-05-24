import { createBrowserRouter } from "react-router-dom";

import { BrowsePage } from "@/routes/BrowsePage";
import { CardDetailPage } from "@/routes/CardDetailPage";
import { HomePage } from "@/routes/HomePage";
import { RootLayout } from "@/routes/RootLayout";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "cards", element: <BrowsePage /> },
      { path: "cards/:oracleId", element: <CardDetailPage /> },
    ],
  },
]);
