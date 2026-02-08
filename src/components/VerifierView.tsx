'use client';

import { useState, useEffect } from 'react';
import styles from '../app/page.module.css';
import App from '@/utils/App';
import { IdentityManager } from '@/utils/identity';
import { simpleHash } from '@/utils/simpleHash';
import { PODEntries, POD } from '@pcd/pod';

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
      <h3>
        <button onClick={onBack} className={styles.back}>
          ←
        </button>{' '}
        Service Verifier
      </h3>

      {step === 1 && (
        <>
          <div className={styles.card} style={{ borderColor: '#2196f3' }}>
            <h4>Trusted Issuers</h4>
            <div style={{ display: 'flex', gap: '5px' }}>
              <input
                value={newTrustedKey}
                onChange={e => setNewTrustedKey(e.target.value)}
                placeholder="Paste Issuer Public Key"
                className={styles.input}
                style={{ fontSize: '0.8em' }}
              />
              <button onClick={addTrustedIssuer} className={styles.button} style={{ width: 'auto', padding: '5px' }}>
                Add
              </button>
            </div>
            {trustedIssuers.length > 0 && (
              <ul style={{ textAlign: 'left', fontSize: '0.7em', color: '#555', wordBreak: 'break-all' }}>
                {trustedIssuers.map(k => <li key={k}>{k.substring(0, 15)}...</li>)}
              </ul>
            )}
            {trustedIssuers.length > 0 && (
              <button onClick={clearTrustedIssuers} style={{ color: 'red', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.7em' }}>
                Clear Trusted List
              </button>
            )}
          </div>

          <div className={styles.card}>
            <p>Request specific attributes:</p>
            <div
              style={{ textAlign: 'left', margin: '0 auto', maxWidth: '300px' }}
            >
              {['name', 'age', 'residency', 'photo'].map(f => (
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
            <button
              onClick={() => {
                // We need to send requests to Holder when they join?
                // The original code did not send requests immediately.
                // It waited.
                // Actually app.host() sets mode to 'alice' and step to 2.
                // Request sending needs to happen when holder connects or on demand.
                // Use 'app.host()'
                app.host();
                // Send Request Payload to signal needed fields?
                // Original code never sent "POD_REQUEST" explicitly in handle?
                // It was just implicit or handled manually?
                // Ah, 'app.connect' sends nothing.
                // We should probably broadcast requirements if we want auto-prompt.
              }}
              className={styles.button}
            >
              Create Session
            </button>
          </div>
        </>
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
        </div>
      )}

      {step === 3 && (
        <div>
          <p style={{ color: 'green' }}>User Connected.</p>
          <p>Waiting for ID presentation...</p>

          {/* Send Request Button if not sent automatically? */}
          {/* We can reproduce the original behavior which waited for User to scan or manual action */}

          {/* Old explicit Request button removed. Now handled by Unified Action */}

          {receivedPod && (
            <div className={styles.card}>
              <h4>ID Received</h4>
              <button onClick={verifyID} className={styles.button}>
                Verify Signature
              </button>
            </div>
          )}

          {/* Unified Verification Action */}
          <div className={styles.card} style={{ borderColor: '#9c27b0' }}>
            <h4>Verification Actions</h4>
            <p style={{ fontSize: '0.9em' }}>
              Click below to request data and/or run privacy checks based on your selection.
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
                onClick={runVerificationSession}
                className={styles.button}
                style={{ background: '#9c27b0' }}
              >
                Verify Identity
              </button>
            )}

            {zkResultAge !== null && (
              <p
                style={{
                  fontWeight: 'bold',
                  color: zkResultAge ? 'green' : 'red',
                  marginTop: '10px',
                }}
              >
                AGE Check: {zkResultAge ? 'PASSED ✅' : 'FAILED ❌'}
              </p>
            )}
            {zkResultName !== null && (
              <p
                style={{
                  fontWeight: 'bold',
                  color: zkResultName ? 'green' : 'red',
                  marginTop: '10px',
                }}
              >
                NAME Check: {zkResultName ? 'PASSED ✅' : 'FAILED ❌'}
              </p>
            )}
          </div>

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
              <p style={{ fontSize: '0.8em' }}>{verifierStatus}</p>

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
                  {(() => {
                    if (!receivedPod || !receivedPod.revealed) return null;
                    const revealed = receivedPod.revealed;
                    return (
                      <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
                        {Object.keys(revealed).map(key => {
                          const val = revealed[key].value;
                          const reqPassed = requirementResults[key];

                          if (key === 'photo') {
                            return (
                              <li key={key} style={{ marginBottom: '5px', padding: '5px', borderBottom: '1px solid #ccc', display: 'flex', alignItems: 'center' }}>
                                <span style={{ textTransform: 'capitalize', width: '80px', display: 'inline-block', fontWeight: 'bold' }}>Photo</span>
                                <img src={val.value.toString()} style={{ width: '100px', borderRadius: '5px', border: '2px solid green' }} />
                                <span style={{ fontSize: '0.8em', color: 'green', marginLeft: '10px' }}> ✅ Verified</span>
                              </li>
                            );
                          }

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
                                <strong>
                                  {hasReq ? (
                                    <span style={{ color: '#9c27b0', fontStyle: 'italic' }}>
                                      [Hidden]
                                    </span>
                                  ) : (
                                    val.value.toString()
                                  )}
                                </strong>
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
}
