"use client";

import React from "react";

import "../cavcloud/cavcloud.css";

export function CavSafeOwnerOnlyModal() {
  const [open, setOpen] = React.useState(true);

  return (
    <div className="cavcloud-root" data-theme="lime">
      {open ? (
        <div className="cavcloud-modal" role="dialog" aria-modal="true" aria-labelledby="cavsafe-owner-only-title">
          <div className="cavcloud-modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="cavcloud-modalTitle" id="cavsafe-owner-only-title">
              CavSafe
            </div>
            <div className="cavcloud-modalBody">
              <div className="cavcloud-modalText">Only accessible to the CavBot Account owner.</div>
            </div>
            <div className="cavcloud-modalActions">
              <button className="cavcloud-rowAction" type="button" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
