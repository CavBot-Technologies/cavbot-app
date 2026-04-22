"use client";

import AdminRouteErrorState from "@/components/admin/AdminRouteErrorState";

export default function AdminProtectedError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AdminRouteErrorState error={props.error} reset={props.reset} homeHref="/overview" title="HQ page unavailable" />;
}
