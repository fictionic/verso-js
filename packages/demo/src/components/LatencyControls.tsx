import React from 'react';
import { getCookie, setCookie } from '@verso-js/verso';

const OPTIONS = [10, 100, 500, 1000];

interface RadioGroupProps {
  label: string;
  cookieName: string;
  fallback: number;
}

function LatencyRadioGroup({ label, cookieName, fallback }: RadioGroupProps) {
  const current = Number(getCookie(cookieName)) || fallback;
  return (
    <div style={{ marginBottom: '16px' }}>
      <div
        style={{
          fontSize: '11px',
          color: '#6c7086',
          marginBottom: '8px',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {OPTIONS.map((ms) => (
          <label
            key={ms}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '13px' }}
          >
            <input
              type="radio"
              name={cookieName}
              value={String(ms)}
              defaultChecked={current === ms}
              onChange={() => {
                setCookie(cookieName, String(ms));
                window.location.reload();
              }}
            />
            {ms}ms
          </label>
        ))}
      </div>
    </div>
  );
}

export function LatencyControls() {
  return (
    <div
      style={{
        background: '#1e1e2e',
        border: '1px solid #313244',
        borderRadius: '8px',
        padding: '16px',
      }}
    >
      <h3 style={{ margin: '0 0 16px', fontSize: '14px', color: '#cba6f7', fontWeight: 600 }}>
        Latency Controls
      </h3>
      <LatencyRadioGroup label="Users API" cookieName="latency_users" fallback={500} />
      <LatencyRadioGroup label="Theme API" cookieName="latency_theme" fallback={400} />
      <LatencyRadioGroup label="Activity API" cookieName="latency_activity" fallback={1500} />
    </div>
  );
}
