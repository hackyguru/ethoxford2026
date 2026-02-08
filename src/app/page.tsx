'use client';

import { useMemo, useState, useEffect } from 'react';
import styles from './page.module.css';
import App from '@/utils/App';
import ProfileTab from '@/components/ProfileTab';
import VerifyTab from '@/components/VerifyTab';

export default function Home() {
  const app = useMemo(() => new App(), []);

  // Navigation State
  const [activeTab, setActiveTab] = useState<'verify' | 'profile'>('verify');
  const [hasUnreadAlerts, setHasUnreadAlerts] = useState(false);

  useEffect(() => {
    // Auto-detect link code
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      if (code) {
        // If there's a code, we go to "Get Verified" flow.
        // We'll pass this via app state, but we need to ensure we are on Verify Tab
        setActiveTab('verify');
        app.joiningCode.set(code);
        // Note: verifyTab will need to default to 'get_verified' if it sees a code? 
        // Or we can just let the user click it. 
        // Better UX: VerifyTab automatically opens HolderView?
        // For now let's just switch tab.
      }
    }
  }, [app]);

  return (
    <div className={styles.container}>

      {/* Main Content Area */}
      <div className={styles.contentArea}>
        {activeTab === 'verify' && <VerifyTab app={app} />}
        {activeTab === 'profile' && <ProfileTab app={app} />}
      </div>

      {/* Bottom Navigation Bar */}
      <div className={styles.bottomNav}>
        <button
          className={`${styles.navItem} ${activeTab === 'verify' ? styles.navItemActive : ''}`}
          onClick={() => setActiveTab('verify')}
        >
          <span className={styles.navIcon}>⚡</span>
          <span>Verify</span>
        </button>

        <button
          className={`${styles.navItem} ${activeTab === 'profile' ? styles.navItemActive : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          <div style={{ position: 'relative' }}>
            <span className={styles.navIcon}>👤</span>
            {hasUnreadAlerts && <span style={{ position: 'absolute', top: 0, right: -5, width: 8, height: 8, background: 'red', borderRadius: '50%' }} />}
          </div>
          <span>Profile</span>
        </button>
      </div>

    </div>
  );
}
