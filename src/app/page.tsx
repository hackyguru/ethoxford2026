'use client';

import { useMemo, useState, useEffect } from 'react';
import styles from './page.module.css';
import App from '@/utils/App';
import { IdentityManager, IdentityData } from '@/utils/identity';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';

export default function Home() {
  const app = useMemo(() => new App(), []);

  // App State
  // mode: 'home' | 'issuer' | 'holder' | 'verifier'
  const [mode, setMode] = useState<'home' | 'issuer' | 'holder' | 'verifier'>(
    'home',
  );

  // Issuer State
  const [issuerKey, setIssuerKey] = useState<string>('');
  const [issuerPk, setIssuerPk] = useState<string>('');
  const [issueData, setIssueData] = useState<IdentityData>({
    name: 'Alice',
    age: 25,
    residency: 'USA',
  });
  const [mintedPod, setMintedPod] = useState<string>('');

  // Holder State
  const [myPod, setMyPod] = useState<string>(''); // Serialized POD
  const [myIssuerPk, setMyIssuerPk] = useState<string>('');
  const [holderStatus, setHolderStatus] = useState<string>('Idle');
  const [isScanning, setIsScanning] = useState(false);

  // Verifier State
  const [verifierStatus, setVerifierStatus] = useState<string>('Idle');
  const [receivedPod, setReceivedPod] = useState<any>(null);
  const [receivedIssuerPk, setReceivedIssuerPk] = useState<string>('');
  const [verificationResult, setVerificationResult] = useState<boolean | null>(
    null,
  );
  const [requestedFields, setRequestedFields] = useState<string[]>([
    'name',
    'age',
    'residency',
  ]); // Default all

  // Custom Verification Logic
  type Requirement = { op: '==' | '>=' | '<='; val: string };
  const [requirements, setRequirements] = useState<Record<string, Requirement>>(
    {},
  );
  const [requirementResults, setRequirementResults] = useState<
    Record<string, boolean>
  >({});

  // Holder State for Request
  const [pendingRequest, setPendingRequest] = useState<string[]>([]);
  // const [disclosedData, setDisclosedData] = useState<any>(null);

  // MPC / ZK State
  const [mpcRequest, setMpcRequest] = useState<{ minAge: number } | null>(null);
  const [zkResult, setZkResult] = useState<boolean | null>(null);
  const mpcProgress = app.progress.use();

  // Common Connection State
  const step = app.step.use();
  // const party = app.party.use();
  const joiningCode = app.joiningCode.use();
  const [spinner, setSpinner] = useState(false);

  // Send request when Verifier connects
  useEffect(() => {
    if (mode === 'verifier' && step === 3 && requestedFields.length > 0) {
      setTimeout(() => {
        console.log('Sending Request', requestedFields);
        app.sendData({ type: 'POD_REQUEST', fields: requestedFields });
      }, 500);
    }
  }, [mode, step, app, requestedFields]);

  useEffect(() => {
    // Auto-connect if code exists and ID is ready
    if (mode === 'holder' && step === 1 && joiningCode && myPod) {
      // Optional: Auto-connect or just Highlight
      // console.log("Auto-connecting with code:", joiningCode);
      // To avoid loops or issues, we'll just let the button be enabled and visible.
      // But users asked "I STILL GET ASKED". Maybe we should scroll to it or emphasize it.
    }
  }, [mode, step, joiningCode, myPod]);

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

  useEffect(() => {
    // Generate Issuer Key on load (mock setup)
    try {
      const key = IdentityManager.generateIssuerKey();
      setIssuerKey(key);
      IdentityManager.getPublicKey(key).then(setIssuerPk);
    } catch (e) {
      console.error('Failed to init crypto', e);
    }

    // Listen for data
    if (app && app.onData) {
      app.onData((data: any) => {
        if (data.type === 'POD_REQUEST') {
          setPendingRequest(data.fields);
        }
        if (data.type === 'POD_PRESENTATION') {
          // data.presentation is the ZK/Selective proof object
          setReceivedPod(data.presentation);
          setReceivedIssuerPk(data.issuerPk);
          setVerifierStatus('Received Proof. Verifying...');
        }
        if (data.type === 'MPC_REQUEST') {
          setMpcRequest({ minAge: Number(data.minAge) });
        }
      });
    }
  }, [app]);
  useEffect(() => {
    if (isScanning && mode === 'holder' && !myPod) {
      const scanner = new Html5QrcodeScanner(
        'reader',
        { fps: 10, qrbox: { width: 250, height: 250 } },
        /* verbose= */ false,
      );

      scanner.render(
        decodedText => {
          console.log('Scanned:', decodedText);
          importID(decodedText);
          scanner.clear();
          setIsScanning(false);
        },
        _error => {
          // handle scan error
        },
      );

      return () => {
        try {
          scanner.clear();
        } catch (_e) { }
      };
    }
  }, [isScanning, mode, myPod]);

  // Issuer Actions
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

  // Holder Actions
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
      if (!parsed.pod || !parsed.issuerPk) throw new Error('Missing fields');
      setMyPod(parsed.pod);
      setMyIssuerPk(parsed.issuerPk);
      setHolderStatus('ID Imported');
    } catch (e) {
      alert('Invalid ID Format: ' + e);
    }
  };

  const sendID = () => {
    if (!myPod) return;
    try {
      // Use Real ZK/Selective Disclosure Presentation
      // 1. Deserialize my POD
      const pod = IdentityManager.deserializePOD(myPod);

      // 2. Determine fields to reveal (from pending request or default)
      const fieldsToReveal =
        pendingRequest.length > 0
          ? pendingRequest
          : ['age', 'residency', 'name'];
      console.log('Generating Proof for:', fieldsToReveal);

      // 3. Create Cryptographic Presentation
      const presentation = IdentityManager.createPresentation(
        pod,
        fieldsToReveal,
      );

      app.sendData({
        type: 'POD_PRESENTATION',
        presentation: presentation, // Use new structure
        issuerPk: myIssuerPk,
      });
      setHolderStatus('ID Proof Sent (Selectively Revealed)');
      setPendingRequest([]);
    } catch (e) {
      console.error('Failed to generate proof', e);
      alert('Proof generation failed!');
    }
  };

  const startZKAgeCheck = async () => {
    if (!mpcRequest || !myPod) return;
    try {
      setHolderStatus('Initializing Secure MPC...');
      const pod = IdentityManager.deserializePOD(myPod);
      const ageVal = pod.content.getValue('age');
      if (!ageVal) throw new Error('Age not found in ID');

      const myAge = Number(ageVal.value); // Ensure number

      setHolderStatus('Running Zero-Knowledge Proof... (Please wait)');
      const result = await app.runVerification({ age: myAge, residency: 1 });

      setHolderStatus(
        result
          ? 'ZK Proof Passed! Verifier knows checking passed.'
          : 'ZK Proof FAILED.',
      );
      setMpcRequest(null);
    } catch (e) {
      console.error(e);
      setHolderStatus('MPC Failed: ' + String(e));
      setMpcRequest(null);
    }
  };

  const toggleRequest = (field: string) => {
    setRequestedFields(prev =>
      prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field],
    );
  };

  // Verifier Actions
  const verifyID = () => {
    if (!receivedPod) return; // receivedPod now holds "presentation"
    try {
      // Use Real Crypto Verification
      const isValid = IdentityManager.verifyPresentation(
        receivedPod,
        receivedIssuerPk,
      );

      if (isValid) {
        setVerificationResult(true);
        setVerifierStatus(
          'Cryptographically Verified & Checking Conditions...',
        );

        // CHECK REQUIREMENTS
        const results: Record<string, boolean> = {};
        if (receivedPod.revealed) {
          Object.keys(receivedPod.revealed).forEach(key => {
            const rawVal = receivedPod.revealed[key].value.value; // Can be BigInt or string
            const req = requirements[key];
            if (!req || req.val === '') {
              results[key] = true; // No requirement = Pass
              return;
            }

            // Normalize values for comparison
            let actual: number | string = rawVal;
            let target: number | string = req.val;

            // Handle BigInts / Numbers
            if (typeof rawVal === 'bigint') {
              actual = Number(rawVal);
            } else if (typeof rawVal === 'number') {
              actual = rawVal;
            } else {
              actual = String(rawVal);
            }

            // Try to cast target to number if actual is number
            if (typeof actual === 'number' && !isNaN(Number(target))) {
              target = Number(target);
            }

            if (req.op === '==') results[key] = actual == target;
            if (req.op === '>=') results[key] = actual >= target;
            if (req.op === '<=') results[key] = actual <= target;
          });
        }
        setRequirementResults(results);
      } else {
        throw new Error('Signature or Proof Invalid');
      }
    } catch (e) {
      console.error(e);
      setVerificationResult(false);
      setVerifierStatus('Verification Failed: ' + (e as any).message);
    }
  };

  const verifyAgeZK = async (minAge: number) => {
    try {
      setVerifierStatus('Initiating Zero-Knowledge Check...');
      setZkResult(null);

      // 1. Notify Holder
      await app.sendData({ type: 'MPC_REQUEST', minAge });

      // 2. Start MPC
      setVerifierStatus(
        'Running Secure Multi-Party Computation... (waiting for user)',
      );
      const valid = await app.runVerification({ minAge, requiredResidency: 1 });

      setZkResult(valid);
      setVerifierStatus(
        valid
          ? '✅ ZK Proof Verified: Age Requirement Met!'
          : '❌ ZK Proof Failed: Requirement NOT Met.',
      );
    } catch (e) {
      console.error(e);
      setVerifierStatus('ZK Error: ' + String(e));
    }
  };

  const renderHome = () => (
    <div className={styles.step}>
      <h2>Select Role</h2>
      <div className={styles.card}>
        <button onClick={() => setMode('issuer')} className={styles.button}>
          GOVERNMENT (Issuer)
        </button>
        <p>Mint new Digital IDs</p>
      </div>
      <div className={styles.card}>
        <button onClick={() => setMode('holder')} className={styles.button}>
          CITIZEN (Holder)
        </button>
        <p>Store and Present ID</p>
      </div>
      <div className={styles.card}>
        <button onClick={() => setMode('verifier')} className={styles.button}>
          SERVICE (Verifier)
        </button>
        <p>Verify Attributes</p>
      </div>
    </div>
  );

  const renderIssuer = () => (
    <div className={styles.step}>
      <h3>
        <button onClick={() => setMode('home')} className={styles.back}>
          ←
        </button>{' '}
        Issuer Portal
      </h3>

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
            }}
          >
            <QRCodeSVG value={mintedPod} size={256} />
          </div>
          <button
            className={styles.button}
            style={{ marginTop: '10px', background: '#4CAF50' }}
            onClick={() => {
              try {
                console.log('--- DEBUG: Verifying Minted POD Locally ---');
                const parsed = JSON.parse(mintedPod);
                const pod = IdentityManager.deserializePOD(parsed.pod);
                // Create a full presentation (reveal all)
                const pres = IdentityManager.createPresentation(pod, [
                  'name',
                  'age',
                  'residency',
                ]);
                console.log('Created Presentation:', pres);
                const valid = IdentityManager.verifyPresentation(
                  pres,
                  parsed.issuerPk,
                );
                alert(
                  valid
                    ? 'Local Verification PASSED'
                    : 'Local Verification FAILED (Check Console)',
                );
              } catch (e) {
                console.error(e);
                alert('Error Checking: ' + e);
              }
            }}
          >
            Debug: Verify Now
          </button>
          <p style={{ fontSize: '0.9em', marginTop: '10px' }}>
            User: Scan this to import ID
          </p>
          <button
            onClick={downloadPodFile}
            className={styles.button}
            style={{ background: '#666', fontSize: '0.8em', marginTop: '10px' }}
          >
            Download backup
          </button>
        </div>
      )}
    </div>
  );

  const renderHolder = () => (
    <div className={styles.step}>
      <h3>
        <button onClick={() => setMode('home')} className={styles.back}>
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
            <p>
              ID Loaded: <strong>{myPod ? 'Ready' : 'Empty'}</strong>
            </p>
          </div>

          {step === 1 && (
            <div className={styles.card}>
              <p>Join a Verifier Scssion to present ID</p>
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
                      <h4 style={{ color: '#9c27b0' }}>🔒 Private Age Check</h4>
                      <p>
                        Verifier wants to check if{' '}
                        <strong>Age &ge; {mpcRequest.minAge}</strong>
                      </p>
                      <p style={{ fontSize: '0.9em' }}>
                        Using Zero-Knowledge Proof (MPC). <br />
                        They will <strong>NOT</strong> see your actual age.
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
                      {/* Fallback manual button */}
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

  const renderVerifier = () => (
    <div className={styles.step}>
      <h3>
        <button onClick={() => setMode('home')} className={styles.back}>
          ←
        </button>{' '}
        Service Verifier
      </h3>

      {step === 1 && (
        <div className={styles.card}>
          <p>Request specific attributes:</p>
          <div
            style={{ textAlign: 'left', margin: '0 auto', maxWidth: '300px' }}
          >
            {['name', 'age', 'residency'].map(f => (
              <div
                key={f}
                style={{ marginBottom: '8px', borderBottom: '1px solid #eee' }}
              >
                <label style={{ display: 'block', fontWeight: 'bold' }}>
                  <input
                    type="checkbox"
                    checked={requestedFields.includes(f)}
                    onChange={() => toggleRequest(f)}
                  />{' '}
                  {f}
                </label>
                {requestedFields.includes(f) && (
                  <div
                    style={{
                      marginLeft: '25px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      marginBottom: '5px',
                    }}
                  >
                    <span style={{ fontSize: '0.8em' }}>Req:</span>
                    <select
                      style={{ fontSize: '0.8em' }}
                      value={requirements[f]?.op || '=='}
                      onChange={e =>
                        setRequirements(p => ({
                          ...p,
                          [f]: {
                            op: e.target.value as any,
                            val: p[f]?.val || '',
                          },
                        }))
                      }
                    >
                      <option value="==">==</option>
                      <option value=">=">{'>='}</option>
                      <option value="<=">{'<='}</option>
                    </select>
                    <input
                      style={{
                        fontSize: '0.8em',
                        width: '80px',
                        padding: '2px',
                      }}
                      placeholder="Value"
                      value={requirements[f]?.val || ''}
                      onChange={e =>
                        setRequirements(p => ({
                          ...p,
                          [f]: { op: p[f]?.op || '==', val: e.target.value },
                        }))
                      }
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <p>Start a verification session</p>
          <button onClick={() => app.host()} className={styles.button}>
            Create Session
          </button>
        </div>
      )}

      {step === 2 && (
        <div>
          <p>Share this link to verify identity:</p>
          <div
            className={styles.card}
            style={{
              padding: '15px',
              background: '#f5f5f5',
              wordBreak: 'break-all',
              userSelect: 'all',
              cursor: 'text',
            }}
          >
            {typeof window !== 'undefined'
              ? `${window.location.origin}?code=${joiningCode}`
              : joiningCode}
          </div>
          <p style={{ fontSize: '0.9em', color: '#666' }}>
            Or enter code manually: <strong>{joiningCode}</strong>
          </p>
          <p>Waiting for user...</p>
          {/* Send request as soon as user connects? No, wait for connection event. */}
        </div>
      )}

      {step === 3 && (
        <div>
          <p style={{ color: 'green' }}>User Connected.</p>
          <p>Waiting for ID presentation...</p>

          {receivedPod && (
            <div className={styles.card}>
              <h4>ID Received</h4>
              <button onClick={verifyID} className={styles.button}>
                Verify Signature
              </button>
            </div>
          )}

          {/* ZK Button - Only show if Age condition is set and no POD received yet (alternative flow) */}
          {!receivedPod && requirements['age'] && requirements['age'].val && (
            <div className={styles.card} style={{ borderColor: '#9c27b0' }}>
              <h4 style={{ color: '#9c27b0' }}>🔒 Zero-Knowledge Check</h4>
              <p>
                Verify <strong>Age &ge; {requirements['age'].val}</strong>{' '}
                without revealing strictly.
              </p>
              {mpcProgress > 0 && mpcProgress < 1 ? (
                <div style={{ margin: '10px 0' }}>
                  <div
                    style={{ height: '5px', background: '#eee', width: '100%' }}
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
                  onClick={() => verifyAgeZK(Number(requirements['age'].val))}
                  className={styles.button}
                  style={{ background: '#9c27b0' }}
                >
                  Verify Age (Private MPC)
                </button>
              )}
              {zkResult !== null && (
                <p
                  style={{
                    fontWeight: 'bold',
                    color: zkResult ? 'green' : 'red',
                    marginTop: '10px',
                  }}
                >
                  {zkResult ? 'PASSED ✅' : 'FAILED ❌'}
                </p>
              )}
            </div>
          )}

          {verificationResult !== null && (
            <div className={styles.result}>
              <div
                style={{
                  color: verificationResult ? 'green' : 'red',
                  fontWeight: 'bold',
                }}
              >
                {verificationResult ? '✅ VALID SIGNATURE' : '❌ INVALID'}
              </div>

              {verificationResult && (
                <div
                  style={{
                    marginTop: '10px',
                    textAlign: 'left',
                    background: '#eee',
                    padding: '10px',
                    borderRadius: '5px',
                  }}
                >
                  <p>
                    <strong>Revealed Attributes:</strong>
                  </p>
                  {/* Simulating Selective Retrieval Display */}
                  {(() => {
                    if (!receivedPod || !receivedPod.revealed) return null;
                    const revealed = receivedPod.revealed;
                    return (
                      <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
                        {Object.keys(revealed).map(key => {
                          const val = revealed[key].value;
                          const reqPassed = requirementResults[key];
                          // Only show requiremenet status if one was set
                          const hasReq =
                            requirements[key] && requirements[key].val !== '';

                          return (
                            <li
                              key={key}
                              style={{
                                marginBottom: '5px',
                                padding: '5px',
                                borderBottom: '1px solid #ccc',
                              }}
                            >
                              <div>
                                <span
                                  style={{
                                    textTransform: 'capitalize',
                                    width: '80px',
                                    display: 'inline-block',
                                  }}
                                >
                                  {key}
                                </span>
                                <strong>{val.value.toString()}</strong>
                                <span
                                  style={{
                                    fontSize: '0.8em',
                                    color: 'green',
                                    marginLeft: '5px',
                                  }}
                                >
                                  {' '}
                                  (Verified)
                                </span>
                              </div>
                              {hasReq && (
                                <div
                                  style={{
                                    fontSize: '0.9em',
                                    marginTop: '2px',
                                    color: reqPassed ? 'green' : 'red',
                                  }}
                                >
                                  Condition: {requirements[key]?.op}{' '}
                                  {requirements[key]?.val}
                                  <strong style={{ marginLeft: '10px' }}>
                                    {reqPassed ? '✅ MET' : '❌ FAILED'}
                                  </strong>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className={styles.app}>
      <div className={styles.header}>POD Digital Identity</div>
      <div className={styles['step-container']}>
        {mode === 'home' && renderHome()}
        {mode === 'issuer' && renderIssuer()}
        {mode === 'holder' && renderHolder()}
        {mode === 'verifier' && renderVerifier()}
      </div>
    </div>
  );
}
