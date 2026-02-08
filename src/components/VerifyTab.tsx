'use client';

import { useState, useEffect } from 'react';
import styles from '../app/page.module.css';
import App from '@/utils/App';
import VerifierView from './VerifierView';
import HolderView from './HolderView';

interface VerifyTabProps {
  app: App;
}

export default function VerifyTab({ app }: VerifyTabProps) {
  // Sub-modes for the Verify Tab
  // 'menu' -> Initial choice
  // 'verify_someone' -> VerifierView
  // 'get_verified' -> HolderView (Connection Mode)
  const [subMode, setSubMode] = useState<'menu' | 'verify_someone' | 'get_verified'>('menu');
  const joiningCode = app.joiningCode.use();

  // Auto-switch to Get Verified if code is present
  useEffect(() => {
    if (joiningCode && subMode === 'menu') {
      setSubMode('get_verified');
    }
  }, [joiningCode, subMode]);

  if (subMode === 'verify_someone') {
    return <VerifierView app={app} onBack={() => setSubMode('menu')} />;
  }

  if (subMode === 'get_verified') {
    return <HolderView app={app} onBack={() => setSubMode('menu')} />;
  }

  return (
    <div className={styles.step}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <button onClick={() => setSubMode('verify_someone')} className={styles.card} style={{ cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '20px', padding: '30px', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ fontSize: '2rem', background: 'rgba(255,255,255,0.1)', width: '60px', height: '60px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>🔍</div>
          <div>
            <h3 style={{ margin: 0, color: '#fff', fontSize: '1.2rem', fontWeight: 600 }}>Verify Someone</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.9rem', color: '#888' }}>Request Proofs & Scan IDs</p>
          </div>
        </button>

        <button onClick={() => setSubMode('get_verified')} className={styles.card} style={{ cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '20px', padding: '30px', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ fontSize: '2rem', background: 'rgba(255,255,255,0.1)', width: '60px', height: '60px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>🛡️</div>
          <div>
            <h3 style={{ margin: 0, color: '#fff', fontSize: '1.2rem', fontWeight: 600 }}>Get Verified</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.9rem', color: '#888' }}>Connect to Service & Provide Proof</p>
          </div>
        </button>
      </div>
    </div>
  );
}
