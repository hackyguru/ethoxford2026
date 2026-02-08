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
      <h3>
        <button onClick={onBack} className={styles.back}>
          ←
        </button>{' '}
        Issuer Portal
      </h3>

      <div className={styles.card} style={{ background: '#e3f2fd', marginBottom: '15px' }}>
        <p style={{ margin: '0', fontSize: '0.9em' }}><strong>My Public Key (For Verifiers):</strong></p>
        <code style={{ display: 'block', wordBreak: 'break-all', fontSize: '0.7em', marginTop: '5px' }}>{issuerPk}</code>
        <button
          onClick={() => navigator.clipboard.writeText(issuerPk)}
          style={{ marginTop: '5px', fontSize: '0.7em', padding: '2px 5px' }}
        >
          Copy Key
        </button>
      </div>

      <div className={styles.form}>
        <label>
          Name:{' '}
          <input
            value={issueData.name}
            onChange={e => setIssueData({ ...issueData, name: e.target.value })}
            className={styles.input}
          />
        </label>
        <label>
          Age:{' '}
          <input
            type="number"
            value={issueData.age}
            onChange={e =>
              setIssueData({ ...issueData, age: Number(e.target.value) })
            }
            className={styles.input}
          />
        </label>
        <label>
          Residency:{' '}
          <input
            value={issueData.residency}
            onChange={e =>
              setIssueData({ ...issueData, residency: e.target.value })
            }
            className={styles.input}
          />
        </label>
        <label>
          Photo ID:
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
            style={{ marginTop: '10px' }}
          />
        </label>
        {issueData.photo && (
          <img src={issueData.photo} alt="ID Photo" style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '50%', display: 'block', margin: '10px auto', border: '2px solid #333' }} />
        )}

        <button onClick={mintID} className={styles.button}>
          Mint Digital ID
        </button>
      </div>

      {mintedPod && (
        <div className={styles.result}>
          <p>ID Minted.</p>
          <div
            style={{
              background: 'white',
              padding: '10px',
              display: 'inline-block',
              marginBottom: '10px',
            }}
          >
            <QRCodeSVG value={mintedPod} size={256} />
          </div>
          <div
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontSize: '0.8em',
              background: '#eee',
              padding: '5px',
              fontFamily: 'monospace',
            }}
          >
            {mintedPod.substring(0, 50)}...
          </div>
          <button onClick={downloadPodFile} className={styles.button}>
            Download .pod File
          </button>
        </div>
      )}
    </div>
  );
}
