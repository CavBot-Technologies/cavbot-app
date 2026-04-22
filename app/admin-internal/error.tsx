"use client";

import AdminRouteErrorState from "@/components/admin/AdminRouteErrorState";

export default function AdminError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AdminRouteErrorState error={props.error} reset={props.reset} homeHref="/sign-in" title="HQ unavailable" />;
}
