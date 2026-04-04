// app/auth/challenge/page.tsx
import Link from "next/link";
import CdnBadgeEyes from "@/components/CdnBadgeEyes";
import "./challenge.css";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";


type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};


function pickOne(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}


function labelForMethod(method: string) {
  const m = String(method || "email").toLowerCase().trim();
  if (m === "app" || m === "authenticator") return "authenticator";
  return "email";
}


export default async function ChallengePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const challengeId = String(pickOne(sp.challengeId) || "").trim();
  const methodRaw = String(pickOne(sp.method) || "email").trim();
  const method = labelForMethod(methodRaw);


  return (
    <main className="invite-main">
      <section className="invite-stage" aria-label="Security verification">
        <div className="invite-card" data-tone="watch">
          {/* Top row: CavBot badge + status chip */}
          <div className="invite-top">
            <div className="invite-brand">
              <div className="invite-badge cb-badge cb-badge-inline" aria-hidden="false">
                <div className="cavbot-badge-frame">
                  <CdnBadgeEyes />
                </div>
              </div>


              <div className="invite-brandText">
                <div className="invite-brandSub">Verify your sign-in</div>
              </div>
            </div>


            <div className="invite-chip" data-state="needsAuth">
              action required
            </div>
          </div>


          <div className="invite-divider" />


          {/* spacing starts here */}
          <br />


          {/* Title + body */}
          <h1 className="invite-title">Enter your 6-digit code</h1>


          <br />


          <p className="invite-body">
            {method === "email"
              ? "We sent a 6-digit verification code to your email. Enter it below to complete access."
              : "Enter the 6-digit code from your authenticator app to complete access."}
          </p>


          <br />


          {/* Form */}
          <div className="ch-wrap">
            <form className="ch-form" action="/api/auth/challenge/verify" method="post" aria-label="Verification form">
              <input type="hidden" name="challengeId" value={challengeId} />
              <input type="hidden" name="method" value={method} />


              <br />


              <input
                id="code"
                name="code"
                className="ch-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="••••••"
                maxLength={6}
                aria-label="6-digit verification code"
              />


              <br />


              <button className="invite-btn invite-btn-primary ch-verify" type="button" data-ch-submit="1">
                Verify
                <span className="invite-btn-glow" aria-hidden="true"></span>
              </button>


              <br />


              <div className="ch-actions">
                <button className="invite-btn invite-btn-ghost ch-ghost" type="button" data-ch-resend="1">
                  Resend code
                </button>


                <Link className="invite-btn invite-btn-ghost ch-ghost" href="/auth?mode=login">
                  Back to login
                </Link>
              </div>


              <br />


              <div className="ch-err" data-ch-err="1" aria-live="polite" />
            </form>
          </div>


          <br />


          {/* Footer */}
          <div className="invite-foot">
            <Link className="invite-link" href="/">
              Return to CavBot
            </Link>
          </div>


          <script
            dangerouslySetInnerHTML={{
              __html: `
(function(){
  if (window.__CB_CHALLENGE_WIRED__) return;
  window.__CB_CHALLENGE_WIRED__ = true;


  const err = document.querySelector('[data-ch-err="1"]');
  const btn = document.querySelector('[data-ch-submit="1"]');
  const resend = document.querySelector('[data-ch-resend="1"]');
  const codeEl = document.getElementById('code');


  const challengeId = ${JSON.stringify(challengeId)};
  const method = ${JSON.stringify(method)};


  function setErr(msg){
    if (!err) return;
    err.textContent = msg || '';
  }


  function setBusy(on){
    if (!btn) return;
    if (on){
      btn.setAttribute('data-busy','1');
      btn.classList.add('is-busy');
      btn.textContent = 'Verifying…';
    } else {
      btn.removeAttribute('data-busy');
      btn.classList.remove('is-busy');
      btn.textContent = 'Verify';
    }
  }


  async function verify(){
    try{
      setErr('');
      const code = (codeEl && codeEl.value ? String(codeEl.value) : '').trim();
      if (!challengeId) { setErr('Missing challenge id. Return to login.'); return; }
      if (!/^[0-9]{6}$/.test(code)) { setErr('Enter the 6-digit code.'); return; }


      setBusy(true);
      const res = await fetch('/api/auth/challenge/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challengeId, method, code })
      });


      const data = await res.json().catch(()=>({}));
      if (!res.ok || !data.ok){
        setBusy(false);
        setErr((data && (data.message || data.error)) ? String(data.message || data.error) : 'Verification failed.');
        return;
      }


      window.location.href = '/';
    }catch(e){
      setBusy(false);
      setErr('Verification failed. Please try again.');
    }
  }


  async function resendCode(){
    try{
      setErr('');
      if (!challengeId) { setErr('Missing challenge id. Return to login.'); return; }


      if (resend){ resend.setAttribute('data-busy','1'); resend.textContent = 'Sending…'; }
      const res = await fetch('/api/auth/challenge/resend', {
        method: 'POST',
        headers: { 'content-type':'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challengeId, method })
      });


      const data = await res.json().catch(()=>({}));
      if (resend){ resend.removeAttribute('data-busy'); resend.textContent = 'Resend code'; }


      if (!res.ok || !data.ok){
        setErr((data && (data.message || data.error)) ? String(data.message || data.error) : 'Resend failed.');
        return;
      }
      setErr('A new code was sent.');
    }catch(e){
      if (resend){ resend.removeAttribute('data-busy'); resend.textContent = 'Resend code'; }
      setErr('Resend failed.');
    }
  }


  btn && btn.addEventListener('click', verify);
  resend && resend.addEventListener('click', resendCode);


  codeEl && codeEl.addEventListener('keydown', function(e){
    if (e.key === 'Enter'){ e.preventDefault(); verify(); }
  });


  codeEl && codeEl.addEventListener('input', function(){
    try{
      const v = String(codeEl.value || '').replace(/[^0-9]/g,'').slice(0,6);
      if (codeEl.value !== v) codeEl.value = v;
    }catch(e){}
  });
})();
              `,
            }}
          />
        </div>
      </section>
    </main>
  );
}
