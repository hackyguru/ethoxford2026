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
        // Ensure element exists before initializing
        if (!document.getElementById('reader')) return;

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
        return () => { try { scanner.clear().catch(e => console.log(e)); } catch (e) { } };
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isScanning, myPod]);

  // QR Scanner Effect for Connection
  useEffect(() => {
    // Only run this scan logic if we are "isScanning" AND step is 1 (Connecting) And we have a profile
    if (isScanning && step === 1 && myPod) {
      // Small timeout to ensure DOM is ready
      const timer = setTimeout(() => {
        // Ensure element exists before initializing
        if (!document.getElementById('connection-reader')) return;

        const scanner = new Html5QrcodeScanner(
          'connection-reader',
          { fps: 10, qrbox: { width: 250, height: 250 } },
          false,
        );

        scanner.render(
          decodedText => {
            // Assume the QR text IS the code or a URL containing ?code=...
            let code = decodedText;
            try {
              const url = new URL(decodedText);
              const c = url.searchParams.get('code');
              if (c) code = c;
            } catch (e) { }

            console.log("Scanned Connection Code:", code);
            app.joiningCode.set(code);
            scanner.clear();
            setIsScanning(false);
          },
          _error => { }
        );

        // Store cleanup function
        return () => { try { scanner.clear().catch(e => console.log('Scanner Cleanup Error (Ignored):', e)); } catch (e) { } };
      }, 100);

      // Cleanup cleanup function when the effect re-runs or component unmounts
      return () => {
        clearTimeout(timer);
        // If scanner instance is exposed, we could clean it here, but it's local scope.
        // Effectively the scanner.clear() inside the timeout logic handles it, or the return of the timeout handles it
        // BUT: The issue is scanner.clear() returns a Promise. 
        // If we unmount before scanner is ready, it's fine. 
        // If we unmount after scanner is ready, the inner return runs. 
      };
    }
  }, [isScanning, step, myPod, app]);

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
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
        <button onClick={onBack} className={styles.back} style={{ marginRight: '16px', padding: 0 }}>
          ←
        </button>
        <h3 style={{ margin: 0, color: '#fff' }}>Get Verified</h3>
      </div>

      {!myPod ? (
        <div>
          <div className={styles.card}>
            <h4 style={{ color: '#fff', marginBottom: '20px' }}>Import Identity</h4>

            {!isScanning ? (
              <button
                onClick={() => setIsScanning(true)}
                className={styles.button}
                style={{ marginBottom: '20px', height: '60px', fontSize: '1.2rem' }}
              >
                Scan QR Code
              </button>
            ) : (
              <div style={{ marginBottom: '20px', borderRadius: '12px', overflow: 'hidden', border: '1px solid #333' }}>
                <div id="reader" style={{ width: '100%' }}></div>
                <button
                  onClick={() => setIsScanning(false)}
                  className={styles.buttonSecondary}
                >
                  Cancel
                </button>
              </div>
            )}

            <div style={{ position: 'relative', height: '20px', margin: '20px 0' }}>
              <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
              <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#050505', padding: '0 10px', color: '#666', fontSize: '0.8rem' }}>OR UPLOAD</span>
            </div>

            <div style={{
              border: '1px dashed rgba(255,255,255,0.2)',
              borderRadius: '12px',
              padding: '20px',
              textAlign: 'center',
              transition: 'border-color 0.2s',
              cursor: 'pointer'
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
                  top: 0
                }}
              />
              <span style={{ color: '#aaa' }}>Select .pod or .json file</span>
            </div>
          </div>
        </div>
      ) : (
        <div>
          {step === 1 && (
            <div className={styles.card}>
              <h4 style={{ color: '#fff' }}>Join Session</h4>
              <p style={{ fontSize: '0.9rem', color: '#888', marginBottom: '20px' }}>
                Scan a verifier's QR code or enter a session code to connect.
              </p>

              {!isScanning ? (
                <button onClick={() => setIsScanning(true)} className={styles.button} style={{ marginBottom: '16px' }}>
                  📷 Scan Verifier QR
                </button>
              ) : (
                <div style={{ marginBottom: '16px', borderRadius: '12px', overflow: 'hidden', border: '1px solid #333' }}>
                  <div id="connection-reader" style={{ width: '100%' }}></div>
                  <button onClick={() => setIsScanning(false)} className={styles.buttonSecondary}>Cancel Scan</button>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
                <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
                <span style={{ color: '#666', fontSize: '0.8rem', textTransform: 'uppercase' }}>OR</span>
                <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
              </div>

              <input
                type="text"
                value={joiningCode}
                placeholder="Enter Session Code"
                onChange={e => app.joiningCode.set(e.target.value)}
                className={styles.input}
                style={{ marginTop: '20px' }}
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
                className={styles.buttonSecondary}
                disabled={!joiningCode}
              >
                {spinner ? 'Connecting...' : 'Connect Manually'}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className={styles.card} style={{ alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
              <div className={styles.spinner}></div>
              <p style={{ marginTop: '20px', color: '#888' }}>Establishing secure channel...</p>
            </div>
          )}

          {step === 3 && (
            <div className={styles.card} style={{ borderColor: 'rgba(74, 222, 128, 0.4)' }}>
              <div style={{
                background: 'rgba(74, 222, 128, 0.1)',
                padding: '16px',
                borderRadius: '12px',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <span style={{ fontSize: '1.5em' }}>🔒</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 'bold', color: '#fff' }}>Secure Channel Active</div>
                  <div style={{ fontSize: '0.8rem', color: '#4ade80' }}>Connected to Verifier</div>
                </div>
              </div>

              {pendingRequest.length > 0 ? (
                <div style={{ animation: 'fadeIn 0.3s' }}>
                  <h4 style={{ color: '#fbbf24', marginBottom: '10px' }}>Data Request</h4>
                  <p style={{ fontSize: '0.9rem', color: '#aaa', marginBottom: '16px' }}>
                    The verifier is requesting:
                  </p>
                  <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '12px', margin: '16px 0' }}>
                    <ul style={{ textAlign: 'left', paddingLeft: '20px', margin: 0, color: '#fff' }}>
                      {pendingRequest.map(f => (
                        <li key={f} style={{ marginBottom: '4px' }}>{f.toUpperCase()}</li>
                      ))}
                    </ul>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                    <button onClick={() => setPendingRequest([])} className={styles.buttonSecondary}>Deny</button>
                    <button onClick={sendID} className={styles.button}>Approve & Share</button>
                  </div>
                </div>
              ) : mpcRequest ? (
                <div style={{ animation: 'fadeIn 0.3s' }}>
                  <h4 style={{ color: '#a78bfa', marginBottom: '10px' }}>Private ZK Check</h4>
                  <div style={{ background: 'rgba(167, 139, 250, 0.1)', padding: '16px', borderRadius: '12px', marginBottom: '16px' }}>
                    {mpcRequest.minAge && (
                      <p style={{ margin: '4px 0', color: '#fff' }}>
                        Check: <strong>Age &ge; {mpcRequest.minAge}</strong>
                      </p>
                    )}
                    {mpcRequest.checkName && (
                      <p style={{ margin: '4px 0', color: '#fff' }}>
                        Check: <strong>Name Match</strong>
                      </p>
                    )}
                  </div>
                  <p style={{ fontSize: '0.8em', color: '#aaa', marginTop: 0, marginBottom: '20px' }}>
                    Using Zero-Knowledge Proof (MPC). <br />
                    They will <strong>NOT</strong> see your actual data.
                  </p>
                  {mpcProgress > 0 && mpcProgress < 1 ? (
                    <div style={{ margin: '20px 0' }}>
                      <div
                        style={{
                          height: '6px',
                          background: 'rgba(255,255,255,0.1)',
                          width: '100%',
                          borderRadius: '3px',
                          overflow: 'hidden'
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            background: '#a78bfa',
                            width: `${mpcProgress * 100}%`,
                            transition: 'width 0.2s',
                          }}
                        ></div>
                      </div>
                      <p style={{ fontSize: '0.8rem', color: '#aaa', marginTop: '8px', textAlign: 'right' }}>
                        Computing... {(mpcProgress * 100).toFixed(0)}%
                      </p>
                    </div>
                  ) : (
                    <button
                      onClick={startZKAgeCheck}
                      className={styles.button}
                      style={{ background: 'rgba(167, 139, 250, 0.2)', borderColor: '#a78bfa', color: '#fff' }}
                    >
                      Run Private Check
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '20px 0', color: '#888' }}>
                  {holderStatus === 'ZK Proof Completed. Verifier has received the result.' ? (
                    <p style={{ color: '#4ade80', fontWeight: 'bold' }}>
                      ZK Proof Completed.<br />Verifier has received the result.
                    </p>
                  ) : (
                    <div style={{ opacity: 0.6 }}>Waiting for request...</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
