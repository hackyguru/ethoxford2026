'use client';

import { useState, useEffect } from 'react';
import styles from '../app/page.module.css';
import App from '@/utils/App';
import { IdentityManager } from '@/utils/identity';
import { simpleHash } from '@/utils/simpleHash';
import { PODEntries, POD } from '@pcd/pod';
import { QRCodeSVG } from 'qrcode.react';

interface VerifierViewProps {
  app: App;
  onBack: () => void;
}

// Helper types
type Requirement = { op: '==' | '>=' | '<='; val: string };

export default function VerifierView({ app, onBack }: VerifierViewProps) {
  // Signals
  const step = app.step.use();
  const mpcProgress = app.progress.use();
  const joiningCode = app.joiningCode.use();

  // State
  const [verificationResult, setVerificationResult] = useState<boolean | null>(null);
  const [verifierStatus, setVerifierStatus] = useState<string>('Waiting for connection...');
  const [receivedPod, setReceivedPod] = useState<any>(null); // Presentation
  const [receivedIssuerPk, setReceivedIssuerPk] = useState<string>('');

  // Requirements State
  const [requestedFields, setRequestedFields] = useState<string[]>(['name', 'age', 'residency', 'photo']);
  const [requirements, setRequirements] = useState<Record<string, Requirement>>({});
  const [requirementResults, setRequirementResults] = useState<Record<string, boolean>>({});

  // ZK Results
  const [zkResultAge, setZkResultAge] = useState<boolean | null>(null);
  const [zkResultName, setZkResultName] = useState<boolean | null>(null);

  // Trust State
  const [trustedIssuers, setTrustedIssuers] = useState<string[]>([]);
  const [newTrustedKey, setNewTrustedKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isVerificationStarted, setIsVerificationStarted] = useState(false);

  // Persistence: Trusted Issuers
  useEffect(() => {
    try {
      const storedTrust = localStorage.getItem('trusted_issuers');
      if (storedTrust) setTrustedIssuers(JSON.parse(storedTrust));
    } catch (e) { }
  }, []);

  // Networking: Listen for Presentation
  useEffect(() => {
    if (app && app.onData) {
      app.onData((data: any) => {
        if (data.type === 'POD_PRESENTATION') {
          setReceivedPod(data.presentation);
          setReceivedIssuerPk(data.issuerPk);
          setVerifierStatus('Received Proof. Verifying...');
        }
        // Verifier doesn't receive MPC_REQUEST, it sends it.
      });
    }
  }, [app]);

  // Auto-verify when POD is received
  useEffect(() => {
    if (receivedPod) {
      verifyID();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receivedPod]);

  // Trusted Issuer Management
  const addTrustedIssuer = () => {
    if (!newTrustedKey) return;
    if (!trustedIssuers.includes(newTrustedKey)) {
      const updated = [...trustedIssuers, newTrustedKey];
      setTrustedIssuers(updated);
      localStorage.setItem('trusted_issuers', JSON.stringify(updated));
    }
    setNewTrustedKey('');
  };

  const clearTrustedIssuers = () => {
    setTrustedIssuers([]);
    localStorage.removeItem('trusted_issuers');
  }

  // Verification Logic
  const verifyID = () => {
    if (!receivedPod) return;
    try {
      // Use Real Crypto Verification
      const isValid = IdentityManager.verifyPresentation(
        receivedPod,
        receivedIssuerPk,
      );

      if (isValid) {
        // Trusted Issuer Check
        const isTrusted = trustedIssuers.includes(receivedIssuerPk);
        if (!isTrusted && trustedIssuers.length > 0) {
          alert(`WARNING: Valid Signature, but Issuer Key NOT in Trusted List.\nKey: ${receivedIssuerPk.substring(0, 10)}...`);
        }

        setVerificationResult(true);
        setVerifierStatus(
          isTrusted
            ? '✅ Verified Trusted Issuer & Checking Conditions...'
            : '⚠️ Verified UNTRUSTED Issuer & Checking Conditions...'
        );

        // CHECK REQUIREMENTS (Client Side Logic for revealed attributes)
        const results: Record<string, boolean> = {};
        if (receivedPod.revealed) {
          Object.keys(receivedPod.revealed).forEach(key => {
            const rawVal = receivedPod.revealed[key].value.value;
            const req = requirements[key];
            if (!req || req.val === '') {
              results[key] = true;
              return;
            }

            // Normalize values
            let actual: number | string = rawVal;
            let target: number | string = req.val;

            if (typeof rawVal === 'bigint') {
              actual = Number(rawVal);
            } else if (typeof rawVal === 'number') {
              actual = rawVal;
            } else {
              actual = String(rawVal);
            }

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

  // MPC / ZK Logic
  const verifyAgeZK = async (minAge: number, requiredName: string) => {
    try {
      setVerifierStatus('Initiating Zero-Knowledge Check...');
      setZkResultAge(null);
      setZkResultName(null);

      // 1. Notify Holder
      // Blinded Request: checkName true implies we will check against hidden hash
      await app.sendData({
        type: 'MPC_REQUEST',
        minAge,
        checkName: !!requiredName
      });

      // 2. Start MPC
      setVerifierStatus(
        'Running Secure Multi-Party Computation... (waiting for user)',
      );
      const inputs = {
        minAge,
        requiredResidency: 0,
        requiredNameHash: requiredName ? simpleHash(requiredName) : 0
      };

      const result = await app.runVerification(inputs);

      setZkResultAge(result.ageValid);
      if (requiredName) setZkResultName(result.nameValid);

      setVerifierStatus(
        'ZK Proof Completed.'
      );
    } catch (e) {
      console.error(e);
      setVerifierStatus('ZK Error: ' + String(e));
    }
  };

  // Verification Interaction
  const runVerificationSession = () => {
    setIsVerificationStarted(true);

    // 1. Identify Disclosure Fields (Those WITHOUT specific requirements)
    //    If a field has a requirement (like age >= 18), we might NOT want to reveal it.
    //    But if 'photo' is checked and has no value, we reveal it.
    const disclosureFields = requestedFields.filter(f => {
      const req = requirements[f];
      // If requirement value is set, we treat it as ZK-only (hidden)
      // UNLESS the user explicitly wants to check it openly?
      // For complexity, let's say: Value Set = ZK. Value Empty = Reveal.
      return !req || req.val === '';
    });

    // 2. Identify ZK Fields
    const zkAge = requirements['age']?.val ? Number(requirements['age'].val) : 0;
    const zkName = requirements['name']?.val || '';

    let statusMsg = '';

    // A. Send Disclosure Request
    if (disclosureFields.length > 0) {
      console.log("Requesting Disclosure:", disclosureFields);
      app.sendData({ type: 'POD_REQUEST', fields: disclosureFields });
      statusMsg += 'Requesting Attributes... ';
    }

    // B. Trigger ZK Check
    if (zkAge > 0 || zkName !== '') {
      console.log("Requesting ZK Check");
      // We call the existing ZK function
      verifyAgeZK(zkAge, zkName);
      statusMsg += 'Starting ZK Proof...';
    } else {
      // If no ZK, we just update status manually since verifyAgeZK wasn't called
      setVerifierStatus(statusMsg || 'Waiting for response...');
    }
  };

  const toggleRequest = (field: string) => {
    setRequestedFields(prev =>
      prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field],
    );
  };

  return (
    <div className={styles.step}>
      <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button onClick={onBack} className={styles.back} style={{ marginRight: '16px', padding: 0 }}>
            ←
          </button>
          <h3 style={{ margin: 0, color: '#fff' }}>Verify Someone</h3>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={styles.buttonSecondary}
          style={{ width: 'auto', padding: '8px 12px', fontSize: '0.9rem' }}
        >
          {showSettings ? 'Close' : '⚙️'}
        </button>
      </div>

      {showSettings && (
        <div className={styles.card} style={{ borderColor: 'rgba(255,255,255,0.2)' }}>
          <h4 style={{ color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px', marginBottom: '15px' }}>Trusted Issuers</h4>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
            <input
              value={newTrustedKey}
              onChange={e => setNewTrustedKey(e.target.value)}
              placeholder="Paste Issuer Public Key"
              className={styles.input}
              style={{ fontSize: '0.8em', flex: 1 }}
            />
            <button
              onClick={addTrustedIssuer}
              className={styles.button}
              style={{ width: 'auto', padding: '0 20px', whiteSpace: 'nowrap' }}
            >
              Add Key
            </button>
          </div>
          {trustedIssuers.length > 0 && (
            <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '10px', maxHeight: '300px', overflowY: 'auto' }}>
              <ul style={{ textAlign: 'left', fontSize: '0.75em', color: '#aaa', wordBreak: 'break-all', fontFamily: 'monospace', listStyle: 'none', padding: 0, margin: 0 }}>
                {trustedIssuers.map((k, i) => (
                  <li key={k} style={{ padding: '8px 0', borderBottom: i < trustedIssuers.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                    <span style={{ color: '#fff', marginRight: '8px' }}>[{i + 1}]</span>
                    {k}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {trustedIssuers.length > 0 && (
            <button onClick={clearTrustedIssuers} className={styles.buttonSecondary} style={{ marginTop: '15px', color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.3)' }}>
              Clear Trusted List
            </button>
          )}

          <div style={{ height: '20px' }}></div>
          <p style={{ color: '#888', fontSize: '0.8rem' }}>Add public keys of issuers you trust. The verifier will warn you if a proof is signed by an unknown issuer.</p>
        </div>
      )}

      {!showSettings && step === 1 && (
        <>
          <div className={styles.card}>
            <p style={{ marginBottom: '20px', color: '#fff' }}>Configure Verification Requirements</p>
            <div
              style={{ textAlign: 'left', margin: '0 auto', width: '100%' }}
            >
              {['name', 'age', 'residency', 'photo'].map(f => (
                <div
                  key={f}
                  style={{
                    marginBottom: '12px',
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: '8px',
                    padding: '12px',
                    border: '1px solid rgba(255,255,255,0.05)'
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold', cursor: 'pointer', color: '#fff' }}>
                    <input
                      type="checkbox"
                      checked={requestedFields.includes(f)}
                      onChange={() => toggleRequest(f)}
                      style={{ marginRight: '10px', width: '18px', height: '18px', accentColor: '#fff' }}
                    />{' '}
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </label>
                  {requestedFields.includes(f) && (
                    <div
                      style={{
                        marginLeft: '28px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginTop: '10px',
                      }}
                    >
                      <span style={{ fontSize: '0.8em', color: '#888' }}>Condition:</span>
                      <select
                        className={styles.input}
                        style={{ fontSize: '0.8em', width: '60px', padding: '4px', height: '32px' }}
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
                        className={styles.input}
                        style={{
                          fontSize: '0.8em',
                          flex: 1,
                          padding: '4px 8px',
                          height: '32px',
                          marginTop: 0
                        }}
                        placeholder="Value (Optional)"
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
            <div style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px' }}>
              <button
                onClick={() => {
                  app.host();
                }}
                className={styles.button}
              >
                Start Verification Session
              </button>
            </div>
          </div>
        </>
      )}

      {!showSettings && step === 2 && (
        <div>
          <div className={styles.card}>
            <h4 style={{ color: '#fff', marginBottom: '20px' }}>Waiting for Holder</h4>
            <div style={{ background: '#fff', padding: '16px', borderRadius: '12px', display: 'inline-block', marginBottom: '20px' }}>
              <QRCodeSVG value={`${typeof window !== 'undefined' ? window.location.origin : ''}?code=${joiningCode}`} size={180} />
            </div>
            <p style={{ color: '#888', fontSize: '0.9rem', marginBottom: '10px' }}>
              Share this code or scan with Wallet
            </p>
            <div
              onClick={() => { navigator.clipboard.writeText(joiningCode) }}
              style={{
                padding: '12px',
                background: 'rgba(255,255,255,0.1)',
                borderRadius: '8px',
                fontFamily: 'monospace',
                fontSize: '1.5rem',
                fontWeight: 'bold',
                color: '#fff',
                letterSpacing: '4px',
                cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.1)',
                marginBottom: '24px'
              }}
              title="Click to copy Code"
            >
              {joiningCode}
            </div>

            <div style={{ textAlign: 'left', background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '0.8rem', color: '#888' }}>Share Direct Link</p>
              <div
                onClick={() => {
                  const url = `${window.location.origin}?code=${joiningCode}`;
                  navigator.clipboard.writeText(url);
                }}
                style={{
                  color: '#4ade80',
                  fontSize: '0.85rem',
                  wordBreak: 'break-all',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  textDecoration: 'underline',
                  opacity: 0.9
                }}
                title="Click to copy Link"
              >
                {typeof window !== 'undefined' ? `${window.location.origin}?code=${joiningCode}` : ''}
              </div>
            </div>
          </div>
        </div>
      )}

      {!showSettings && step === 3 && (
        <div style={{ animation: 'fadeIn 0.5s ease-out' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '20px', color: '#4ade80' }}>
            <span style={{ fontSize: '1.2em' }}>●</span> User Connected
          </div>

          {!receivedPod && zkResultAge === null && zkResultName === null && (
            <div className={styles.card} style={{ opacity: 0.8 }}>
              {isVerificationStarted ? (
                <>
                  <div className={styles.spinner}></div>
                  <p style={{ marginTop: '16px', color: '#aaa' }}>Waiting for ID presentation...</p>
                </>
              ) : (
                <button onClick={runVerificationSession} className={styles.buttonSecondary} style={{ marginTop: '20px' }}>
                  Begin Verification
                </button>
              )}
            </div>
          )}

          {receivedPod && (
            <div className={styles.card} style={{ borderColor: 'rgba(255, 255, 255, 0.3)' }}>
              <h4 style={{ color: '#fff' }}>ID Presentation Received</h4>
              <p style={{ fontSize: '0.8rem', color: '#aaa', marginBottom: '20px' }}>
                Issuer PK: {receivedIssuerPk.substring(0, 10)}...
              </p>
            </div>
          )}

          {/* Verification Results */}
          <div className={styles.card} style={{ marginTop: '20px' }}>
            <h4 style={{ color: '#fff', marginBottom: '16px' }}>Verification Status</h4>

            {mpcProgress > 0 && mpcProgress < 1 ? (
              <div style={{ margin: '20px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#aaa', marginBottom: '8px' }}>
                  <span>Zero-Knowledge Check</span>
                  <span>{(mpcProgress * 100).toFixed(0)}%</span>
                </div>
                <div
                  style={{ height: '6px', background: 'rgba(255,255,255,0.1)', width: '100%', borderRadius: '3px', overflow: 'hidden' }}
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
              </div>
            ) : null}

            {zkResultAge === null && zkResultName === null && mpcProgress === 0 && !verificationResult && (
              <p style={{ color: '#666', fontStyle: 'italic' }}>Pending Verification...</p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {zkResultAge !== null && (
                <div style={{
                  padding: '12px',
                  borderRadius: '8px',
                  background: zkResultAge ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)',
                  border: `1px solid ${zkResultAge ? 'rgba(74, 222, 128, 0.3)' : 'rgba(248, 113, 113, 0.3)'}`,
                  color: zkResultAge ? '#4ade80' : '#f87171',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <span>Age Requirement</span>
                  <strong>{zkResultAge ? 'PASSED' : 'FAILED'}</strong>
                </div>
              )}
              {zkResultName !== null && (
                <div style={{
                  padding: '12px',
                  borderRadius: '8px',
                  background: zkResultName ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)',
                  border: `1px solid ${zkResultName ? 'rgba(74, 222, 128, 0.3)' : 'rgba(248, 113, 113, 0.3)'}`,
                  color: zkResultName ? '#4ade80' : '#f87171',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <span>Name Requirement</span>
                  <strong>{zkResultName ? 'PASSED' : 'FAILED'}</strong>
                </div>
              )}
            </div>

            {/* Results List */}
            {verificationResult !== null && (
              <div style={{ marginTop: '24px', textAlign: 'left' }}>
                <div style={{
                  marginBottom: '16px',
                  textAlign: 'center',
                  color: verificationResult ? '#4ade80' : '#f87171',
                  fontSize: '1.2rem',
                  fontWeight: 'bold',
                  textShadow: '0 0 20px rgba(0,0,0,0.5)'
                }}>
                  {verificationResult ? 'CRYPTOGRAPHIC PROOF VALID' : 'PROOF INVALID'}
                </div>

                {verificationResult && receivedPod && receivedPod.revealed && (
                  <div className={styles.card} style={{ background: 'rgba(0,0,0,0.4)', padding: '0' }}>
                    {Object.keys(receivedPod.revealed).map(key => {
                      const val = receivedPod.revealed[key].value;
                      const reqPassed = requirementResults[key];
                      const hasReq = requirements[key] && requirements[key].val !== '';

                      if (key === 'photo') {
                        return (
                          <div key={key} style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div style={{ width: '80px', height: '80px', borderRadius: '8px', overflow: 'hidden', background: '#000' }}>
                              <img src={val.value.toString()} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                            <div>
                              <div style={{ fontSize: '0.8rem', color: '#888', textTransform: 'uppercase' }}>Photo</div>
                              <div style={{ color: '#4ade80', fontSize: '0.9rem' }}>Verified Integrity</div>
                            </div>
                          </div>
                        )
                      }

                      return (
                        <div key={key} style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: '0.8rem', color: '#888', textTransform: 'uppercase' }}>{key}</div>
                            <div style={{ color: hasReq ? '#a78bfa' : '#fff', fontWeight: 'bold', fontSize: '1.1rem' }}>
                              {hasReq ? '[Hidden Value]' : val.value.toString()}
                            </div>
                          </div>

                          {hasReq ? (
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '0.75rem', color: '#666' }}>Condition: {requirements[key]?.op} {requirements[key]?.val}</div>
                              <div style={{ color: reqPassed ? '#4ade80' : '#f87171', fontWeight: 'bold' }}>
                                {reqPassed ? 'MET' : 'FAILED'}
                              </div>
                            </div>
                          ) : (
                            <div style={{ color: '#4ade80', fontSize: '1.2rem' }}>✓</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
