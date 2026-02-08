'use client';

import { useState, useEffect } from 'react';
import styles from '../app/page.module.css';
import { IdentityManager, IdentityData } from '@/utils/identity';
import { QRCodeSVG } from 'qrcode.react';

interface IssuerViewProps {
  onBack: () => void;
}

export default function IssuerView({ onBack }: IssuerViewProps) {
  // Issuer State
  const [issuerKey, setIssuerKey] = useState<string>('');
  const [issuerPk, setIssuerPk] = useState<string>('');
  const [issueData, setIssueData] = useState<IdentityData>({
    name: 'Alice',
    age: 25,
    residency: 'USA',
    photo: '',
  });
  const [mintedPod, setMintedPod] = useState<string>('');

  useEffect(() => {
    // Generate or Load Issuer Key
    const initIssuer = async () => {
      // PERSISTENCE 1: Check LocalStorage
      const storedKey = localStorage.getItem('verifier_issuer_key');
      const storedPk = localStorage.getItem('verifier_issuer_key_pk');

      if (storedKey && storedPk) {
        setIssuerKey(storedKey);
        setIssuerPk(storedPk);
      } else {
        const key = IdentityManager.generateIssuerKey();
        const pk = await IdentityManager.getPublicKey(key);
        setIssuerKey(key);
        setIssuerPk(pk);

        // Save
        localStorage.setItem('verifier_issuer_key', key);
        localStorage.setItem('verifier_issuer_key_pk', pk);
      }
    };
    initIssuer();
  }, []);

  const mintID = () => {
    const pod = IdentityManager.mintPOD(issuerKey, issueData);
    const serialized = IdentityManager.serializePOD(pod);
    // Bundle PK with it for demo ease
    const bundle = JSON.stringify({ pod: serialized, issuerPk });
    setMintedPod(bundle);
  };

  const downloadPodFile = () => {
    if (!mintedPod) return;
    const blob = new Blob([mintedPod], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'identity.pod';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.step}>
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
        <button onClick={onBack} className={styles.back} style={{ marginRight: '16px', padding: 0 }}>
          ←
        </button>
        <h3 style={{ margin: 0, color: '#fff' }}>Issuer Portal</h3>
      </div>

      <div className={styles.card} style={{ marginBottom: '24px' }}>
        <h4 style={{ color: '#fff' }}>Issuer Key</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px' }}>
          <code style={{ flex: 1, wordBreak: 'break-all', fontSize: '0.7em', color: '#aaa' }}>{issuerPk}</code>
          <button
            onClick={() => navigator.clipboard.writeText(issuerPk)}
            style={{
              background: 'none',
              border: '1px solid #555',
              color: '#fff',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '0.7em',
              cursor: 'pointer'
            }}
          >
            COPY
          </button>
        </div>
        <p style={{ margin: '8px 0 0 0', fontSize: '0.8em', color: '#666' }}>Trusted public key for verifiers</p>
      </div>

      <div className={styles.card}>
        <h4>Issue New Identity</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label className={styles.label}>Name</label>
            <input
              value={issueData.name}
              onChange={e => setIssueData({ ...issueData, name: e.target.value })}
              className={styles.input}
              placeholder="Alice Doe"
            />
          </div>

          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{ flex: 1 }}>
              <label className={styles.label}>Age</label>
              <input
                type="number"
                value={issueData.age}
                onChange={e =>
                  setIssueData({ ...issueData, age: Number(e.target.value) })
                }
                className={styles.input}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className={styles.label}>Residency</label>
              <input
                value={issueData.residency}
                onChange={e =>
                  setIssueData({ ...issueData, residency: e.target.value })
                }
                className={styles.input}
              />
            </div>
          </div>

          <div>
            <label className={styles.label}>Photo ID</label>
            <div style={{
              border: '1px dashed rgba(255,255,255,0.2)',
              borderRadius: '12px',
              padding: '16px',
              textAlign: 'center',
              cursor: 'pointer',
              position: 'relative'
            }}>
              <input
                type="file"
                accept="image/*"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setIssueData({ ...issueData, photo: reader.result as string });
                    };
                    reader.readAsDataURL(file);
                  }
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0,
                  cursor: 'pointer'
                }}
              />
              {issueData.photo ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <img src={issueData.photo} alt="ID" style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover' }} />
                  <span style={{ fontSize: '0.9em' }}>Photo Selected</span>
                </div>
              ) : (
                <span style={{ color: '#888', fontSize: '0.9em' }}>Click to upload photo</span>
              )}
            </div>
          </div>

          <button onClick={mintID} className={styles.button} style={{ marginTop: '8px' }}>
            Mint Digital ID
          </button>
        </div>
      </div>

      {mintedPod && (
        <div className={styles.card} style={{ borderColor: 'rgba(74, 222, 128, 0.4)' }}>
          <h4 style={{ color: '#4ade80' }}>Success</h4>
          <p style={{ fontSize: '0.9em', color: '#ccc' }}>Digital Identity created successfully.</p>
          <div
            style={{
              background: 'white',
              padding: '16px',
              margin: '16px auto',
              borderRadius: '12px',
              maxWidth: '220px'
            }}
          >
            <QRCodeSVG value={mintedPod} size={200} style={{ width: '100%', height: 'auto' }} />
          </div>
          <button onClick={downloadPodFile} className={styles.buttonSecondary}>
            Download .pod File
          </button>
        </div>
      )}
    </div>
  );
}
