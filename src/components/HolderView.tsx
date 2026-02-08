'use client';

import { useState, useEffect, useMemo } from 'react';
import styles from '../app/page.module.css';
import App from '@/utils/App';
import { IdentityManager } from '@/utils/identity';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { simpleHash } from '@/utils/simpleHash';

interface HolderViewProps {
  app: App;
  onBack: () => void;
}

export default function HolderView({ app, onBack }: HolderViewProps) {
  // State
  const [myPod, setMyPod] = useState<string>('');
  const [myIssuerPk, setMyIssuerPk] = useState<string>('');
  const [holderStatus, setHolderStatus] = useState<string>('Idle');
  const [isScanning, setIsScanning] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<string[]>([]);
  const [mpcRequest, setMpcRequest] = useState<{ minAge?: number; checkName?: boolean } | null>(null);
  const [spinner, setSpinner] = useState(false);

  // Signals
  const step = app.step.use();
  const mpcProgress = app.progress.use();
  const joiningCode = app.joiningCode.use(); // Use shared state

  // Photo Extraction
  const myPhoto = useMemo(() => {
    if (!myPod) return null;
    try {
      const pod = IdentityManager.deserializePOD(myPod);
      // @ts-ignore
      const content = pod.content.getEntries ? pod.content.getEntries() : pod.content;
      return content.photo?.value;
    } catch { return null; }
  }, [myPod]);

  // Persistence: Load Holder Data
  useEffect(() => {
    const cachedPod = localStorage.getItem('my_pod_data');
    if (cachedPod) {
      importID(cachedPod);
    }
  }, []);

  // Networking: Listen for Requests
  useEffect(() => {
    if (app && app.onData) {
      app.onData((data: any) => {
        if (data.type === 'POD_REQUEST') {
          setPendingRequest(data.fields);
        }
        if (data.type === 'MPC_REQUEST') {
          setMpcRequest({ minAge: Number(data.minAge), checkName: data.checkName });
        }
      });
    }
  }, [app]);

  // QR Scanner Effect
  useEffect(() => {
    if (isScanning && !myPod) {
      // Small timeout to ensure DOM is ready
      const timer = setTimeout(() => {
        const scanner = new Html5QrcodeScanner(
          'reader',
          { fps: 10, qrbox: { width: 250, height: 250 } },
          false,
        );

        scanner.render(
          decodedText => {
            console.log('Scanned:', decodedText);
            importID(decodedText);
            scanner.clear();
            setIsScanning(false);
          },
          _error => { }
        );

        // Cleanup
        return () => { try { scanner.clear(); } catch (e) { } };
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isScanning, myPod]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      importID(text);
    };
    reader.readAsText(file);
  };

  const importID = (json: string) => {
    try {
      const parsed = JSON.parse(json);
      // Basic validation
      if (!parsed.pod || !parsed.issuerPk) throw new Error("Missing fields");
      setMyPod(parsed.pod);
      setMyIssuerPk(parsed.issuerPk);
      setHolderStatus('ID Imported');

      // Persistence
      localStorage.setItem('my_pod_data', json);
    } catch (e) {
      alert('Invalid ID Format: ' + e);
    }
  };

  const sendID = () => {
    if (!myPod) return;
    try {
      const pod = IdentityManager.deserializePOD(myPod);

      const fieldsToReveal =
        pendingRequest.length > 0
          ? pendingRequest
          : ['age', 'residency', 'name', 'photo'];

      const presentation = IdentityManager.createPresentation(pod, fieldsToReveal);

      app.sendData({
        type: 'POD_PRESENTATION',
        presentation: presentation,
        issuerPk: myIssuerPk
      });
      setHolderStatus('ID Proof Sent (Selectively Revealed)');
      setPendingRequest([]);
    } catch (e) {
      console.error("Failed to generate proof", e);
      alert("Proof generation failed!");
    }
  };

  const startZKAgeCheck = async () => {
    if (!mpcRequest || !myPod) return;
    try {
      setHolderStatus('Initializing Secure MPC...');
      const pod = IdentityManager.deserializePOD(myPod);

      let myAge = 0;
      let myName = "";

      const ageVal = pod.content.getValue('age');
      if (ageVal) myAge = Number(ageVal.value);

      const nameVal = pod.content.getValue('name');
      if (nameVal) myName = String(nameVal.value);

      setHolderStatus('Running Zero-Knowledge Proof... (Please wait)');

      const inputs = {
        age: myAge,
        residency: 1,
        nameHash: myName ? simpleHash(myName) : 0
      };

      const result = await app.runVerification(inputs);

      const passed = result.ageValid && result.nameValid;

      setHolderStatus(
        'ZK Proof Completed. Verifier has received the result.'
      );
      setMpcRequest(null);
    } catch (e) {
      console.error(e);
      setHolderStatus('MPC Failed: ' + String(e));
      setMpcRequest(null);
    }
  };

  return (
    <div className={styles.step}>
      <h3>
        <button onClick={onBack} className={styles.back}>
          ←
        </button>{' '}
        Citizen Wallet
      </h3>

      {!myPod ? (
        <div>
          <p>Import Digital Identity</p>
          <div className={styles.card}>
            {!isScanning ? (
              <button
                onClick={() => setIsScanning(true)}
                className={styles.button}
              >
                📷 Scan QR Code
              </button>
            ) : (
              <div id="reader" style={{ width: '100%' }}></div>
            )}
          </div>
          {isScanning && (
            <button
              onClick={() => setIsScanning(false)}
              className={styles.button}
              style={{ background: '#888' }}
            >
              Cancel Scan
            </button>
          )}

          <p style={{ fontSize: '0.9em', marginTop: '20px' }}>
            Or upload backup:
          </p>
          <input
            type="file"
            accept=".pod,.json"
            onChange={handleFileUpload}
            className={styles.input}
          />
        </div>
      ) : (
        <div>
          <div className={styles.card} style={{ background: '#e3f2fd' }}>
            <h4>My Digital ID</h4>
            {myPhoto && (
              <img src={String(myPhoto)} alt="My ID Photo" style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', margin: '0 auto 10px', border: '2px solid #ccc', display: 'block' }} />
            )}
            <p>
              ID Loaded: <strong>{myPod ? 'Ready' : 'Empty'}</strong>
            </p>
          </div>

          {step === 1 && (
            <div className={styles.card}>
              <p>Join a Verifier Session to present ID</p>
              <input
                type="text"
                value={joiningCode}
                placeholder="Enter Session Code from Verifier"
                onChange={e => app.joiningCode.set(e.target.value)}
                className={styles.input}
              />
              <button
                onClick={async () => {
                  setSpinner(true);
                  // app.joiningCode is already set via onChange
                  app.step.set(2);
                  try {
                    await app.connect(joiningCode, 'bob');
                  } catch (e) {
                    console.error(e);
                    alert('Connection failed. Check code.');
                    app.step.set(1);
                  } finally {
                    setSpinner(false);
                  }
                }}
                className={styles.button}
                disabled={!joiningCode}
              >
                {spinner ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          )}

          {step === 2 && <div>Connecting...</div>}

          {step === 3 && (
            <div>
              <p style={{ color: 'green' }}>Connected to Verifier!</p>

              {pendingRequest.length > 0 ? (
                <div className={styles.card} style={{ borderColor: '#ff9800' }}>
                  <p>
                    <strong>Verifier Request:</strong>
                  </p>
                  <ul style={{ textAlign: 'left' }}>
                    {pendingRequest.map(f => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <p>Do you want to disclose these attributes?</p>
                  <button onClick={sendID} className={styles.button}>
                    Approve & Share
                  </button>
                </div>
              ) : (
                <div>
                  {mpcRequest ? (
                    <div
                      className={styles.card}
                      style={{ borderColor: '#9c27b0' }}
                    >
                      <h4 style={{ color: '#9c27b0' }}>🔒 Private ZK Check</h4>
                      {mpcRequest.minAge && (
                        <p>
                          Verifier wants to check if{' '}
                          <strong>Age &ge; {mpcRequest.minAge}</strong>
                        </p>
                      )}
                      {mpcRequest.checkName && (
                        <p>
                          Verifier wants to check if{' '}
                          <strong>Name == [Hidden Target Name]</strong>
                        </p>
                      )}

                      <p style={{ fontSize: '0.9em' }}>
                        Using Zero-Knowledge Proof (MPC). <br />
                        They will <strong>NOT</strong> see your actual data.
                      </p>

                      {mpcProgress > 0 && mpcProgress < 1 ? (
                        <div style={{ margin: '10px 0' }}>
                          <div
                            style={{
                              height: '5px',
                              background: '#eee',
                              width: '100%',
                            }}
                          >
                            <div
                              style={{
                                height: '100%',
                                background: '#9c27b0',
                                width: `${mpcProgress * 100}%`,
                                transition: 'width 0.2s',
                              }}
                            ></div>
                          </div>
                          <p style={{ fontSize: '0.8em' }}>
                            Computing... {(mpcProgress * 100).toFixed(0)}%
                          </p>
                        </div>
                      ) : (
                        <button
                          onClick={startZKAgeCheck}
                          className={styles.button}
                          style={{ background: '#9c27b0' }}
                        >
                          Run Private Check
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <p>Waiting for request...</p>
                      <button
                        onClick={sendID}
                        className={styles.button}
                        style={{ opacity: 0.5 }}
                      >
                        Force Share All
                      </button>
                    </>
                  )}
                </div>
              )}

              <p>{holderStatus}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
