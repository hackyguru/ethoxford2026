'use client';

import { useMemo, useState, useEffect } from 'react';
import styles from './page.module.css';
import App from '@/utils/App';
import IssuerView from '@/components/IssuerView';
import HolderView from '@/components/HolderView';
import VerifierView from '@/components/VerifierView';

export default function Home() {
  const app = useMemo(() => new App(), []);

  // Mode: 'home' | 'issuer' | 'holder' | 'verifier'
  const [mode, setMode] = useState<'home' | 'issuer' | 'holder' | 'verifier'>('home');

  useEffect(() => {
    // Auto-detect link code
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      if (code) {
        setMode('holder');
        app.joiningCode.set(code);
      }
    }
  }, [app]);

  const goBack = () => {
    // Reset basic app state to allow re-joining/hosting logic to reset
    app.step.set(1);
    setMode('home');
  };

  return (
    <div className={styles.container}>
      {mode === 'home' && (
        <div className={styles.step}>
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <h1 style={{ fontSize: '2.5rem', color: '#333' }}>VeriPod</h1>
            <p style={{ color: '#666' }}>Privacy-First Digital Identity Wallet</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', maxWidth: '400px', margin: '0 auto' }}>
            <button onClick={() => setMode('issuer')} className={styles.card} style={{ cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '15px', padding: '20px' }}>
              <div style={{ fontSize: '2rem' }}>🏛️</div>
              <div>
                <h3 style={{ margin: 0 }}>Government (Issuer)</h3>
                <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>Mint verified digital IDs for citizens</p>
              </div>
            </button>

            <button onClick={() => setMode('holder')} className={styles.card} style={{ cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '15px', padding: '20px' }}>
              <div style={{ fontSize: '2rem' }}>👤</div>
              <div>
                <h3 style={{ margin: 0 }}>Citizen (Holder)</h3>
                <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>Manage your ID & prove attributes</p>
              </div>
            </button>

            <button onClick={() => setMode('verifier')} className={styles.card} style={{ cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '15px', padding: '20px' }}>
              <div style={{ fontSize: '2rem' }}>🔍</div>
              <div>
                <h3 style={{ margin: 0 }}>Service (Verifier)</h3>
                <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>Verify ages, names, & residency</p>
              </div>
            </button>
          </div>

          <div style={{ marginTop: '50px', borderTop: '1px solid #ccc', paddingTop: '20px', textAlign: 'center' }}>
            <p style={{ fontSize: '0.8em', color: '#888' }}>Debug Actions</p>
            <button
              className={styles.button}
              style={{ background: '#d32f2f', fontSize: '0.8em', width: 'auto' }}
              onClick={() => {
                if (confirm("Are you sure? This will delete all keys and IDs.")) {
                  localStorage.clear();
                  window.location.reload();
                }
              }}
            >
              Reset All Data (Clear Storage)
            </button>
          </div>
        </div>
      )}

      {mode === 'issuer' && <IssuerView onBack={goBack} />}
      {mode === 'holder' && <HolderView app={app} onBack={goBack} />}
      {mode === 'verifier' && <VerifierView app={app} onBack={goBack} />}
    </div>
  );
}
