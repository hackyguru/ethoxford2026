'use client';

import { useState, useEffect, useMemo } from 'react';
import styles from '../app/page.module.css';
import { IdentityManager } from '@/utils/identity';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import IssuerView from './IssuerView';
import App from '@/utils/App';

interface ProfileTabProps {
  app: App;
}

export default function ProfileTab({ app }: ProfileTabProps) {
  const [mode, setMode] = useState<'view' | 'mint' | 'import'>('view');
  const [myPod, setMyPod] = useState<string>('');
  const [myIssuerPk, setMyIssuerPk] = useState<string>('');
  const [photo, setPhoto] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  // Import related
  const [isScanning, setIsScanning] = useState(false);

  // Load ID on mount
  useEffect(() => {
    const cachedPod = localStorage.getItem('my_pod_data');
    if (cachedPod) {
      loadID(cachedPod);
    }
    setIsLoading(false);
  }, []);

  const loadID = (json: string) => {
    try {
      const parsed = JSON.parse(json);
      setMyPod(parsed.pod);
      setMyIssuerPk(parsed.issuerPk);

      // Extract details for display
      const pod = IdentityManager.deserializePOD(parsed.pod);
      // @ts-ignore
      const content = pod.content.getEntries ? pod.content.getEntries() : pod.content;
      setPhoto(content.photo?.value as string);

      setMode('view');
    } catch (e) {
      console.error("Failed to load ID", e);
    }
  };

  const handleImport = (json: string) => {
    // Basic validation
    try {
      JSON.parse(json);
      localStorage.setItem('my_pod_data', json);
      loadID(json);
    } catch (e) {
      alert("Invalid ID Format");
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      handleImport(text);
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    if (isScanning && mode === 'import') {
      let scanner: Html5QrcodeScanner | null = null;

      const timer = setTimeout(() => {
        if (!document.getElementById('import-reader')) return;

        scanner = new Html5QrcodeScanner(
          'import-reader',
          { fps: 10, qrbox: { width: 250, height: 250 } },
          false,
        );
        scanner.render(
          decodedText => {
            handleImport(decodedText);
            scanner?.clear();
            setIsScanning(false);
          },
          _error => { }
        );
      }, 100);

      return () => {
        clearTimeout(timer);
        try { scanner?.clear().catch(e => console.log(e)); } catch (e) { }
      };
    }
  }, [isScanning, mode]);

  // View: MINT logic
  if (mode === 'mint') {
    return <IssuerView onBack={() => {
      // After minting, we might want to reload if it saved to localstorage?
      // Actually IssuerView only mints but doesn't auto-save to "my_pod_data" in the original logic.
      // It saves "verifier_issuer_key".
      // The original logic required User to Scan the minted ID.
      // For better UX, we can let them "Self Issue".
      window.location.reload();
    }} />;
  }

  // View: IMPORT Logic (Scanner)
  if (mode === 'import') {
    return (
      <div className={styles.step}>
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
          <button onClick={() => setMode('view')} className={styles.back} style={{ marginRight: '16px', padding: 0 }}>
            ←
          </button>
          <h3 style={{ margin: 0, color: '#fff' }}>Import ID</h3>
        </div>
        <div className={styles.card}>
          {!isScanning ? (
            <button onClick={() => setIsScanning(true)} className={styles.button} style={{ height: '60px', fontSize: '1.2rem' }}>📷 Scan QR Code</button>
          ) : (
            <div style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid #333', marginBottom: '16px' }}>
              <div id="import-reader"></div>
            </div>
          )}

          {isScanning && (
            <button onClick={() => setIsScanning(false)} className={styles.buttonSecondary}>Cancel Scan</button>
          )}

          <div style={{ position: 'relative', height: '20px', margin: '10px 0' }}>
            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
            <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#050505', padding: '0 10px', color: '#666', fontSize: '0.8rem' }}>OR UPLOAD</span>
          </div>

          <div style={{
            border: '1px dashed rgba(255,255,255,0.2)',
            borderRadius: '12px',
            padding: '24px',
            textAlign: 'center',
            transition: 'border-color 0.2s',
            cursor: 'pointer',
            position: 'relative'
          }}>
            <input
              type="file"
              accept=".pod,.json"
              onChange={handleFileUpload}
              style={{
                opacity: 0,
                position: 'absolute',
                width: '100%',
                height: '100%',
                left: 0,
                top: 0,
                cursor: 'pointer'
              }}
            />
            <span style={{ color: '#aaa' }}>Select .pod or .json file</span>
          </div>
        </div>
      </div>
    );
  }

  // View: PROFILE Logic
  if (!myPod && !isLoading) {
    return (
      <div className={styles.step}>
        <div className={styles.card} style={{ textAlign: 'center', padding: '48px 24px', alignItems: 'center' }}>
          <div style={{ fontSize: '4rem', opacity: 0.2, marginBottom: '20px' }}>🆔</div>
          <h2 style={{ color: '#fff', marginBottom: '8px' }}>No ID Found</h2>
          <p style={{ color: '#888', maxWidth: '300px', margin: '0 auto 32px' }}>You haven't imported a Digital Identity yet.</p>

          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <button onClick={() => setMode('mint')} className={styles.button}>
              Create New ID
            </button>
            <button onClick={() => setMode('import')} className={styles.buttonSecondary}>
              Import Existing ID
            </button>
          </div>
        </div>
      </div>
    )
  }



  return (
    <div className={styles.step}>
      <div className={`${styles.card} ${styles.profileCard}`} style={{ padding: '40px 24px' }}>


        <div style={{ textAlign: 'center' }}>
          <div className={styles.label} style={{ marginBottom: '16px' }}>Identity QR</div>
          <div className={styles.qrWrapper}>
            <QRCodeSVG value={localStorage.getItem('my_pod_data') || ''} size={180} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '24px', width: '100%' }}>
        <button onClick={() => setMode('import')} className={styles.buttonSecondary} style={{ flex: 1 }}>
          Import
        </button>
        <button onClick={() => setMode('mint')} className={styles.buttonSecondary} style={{ flex: 1 }}>
          New
        </button>
      </div>
    </div>
  );
}
