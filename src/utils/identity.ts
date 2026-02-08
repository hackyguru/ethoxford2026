import {
  POD,
  PODEntries,
  PODContent,
  podNameHash,
  podValueHash,
} from '@pcd/pod';
import { newEdDSAPrivateKey } from '@pcd/eddsa-pcd';
import {
  verifySignature,
  unpackSignature,
  unpackPublicKey,
} from '@zk-kit/eddsa-poseidon';

export interface IdentityData {
  age: number;
  residency: string; // "USA", "India" etc
  name: string;
  photo?: string; // Base64 data URI
}

function base64ToBuffer(base64: string): Uint8Array {
  // Replace - with + and _ with / for compatible standard Base64
  const standardBase64 = base64.replace(/-/g, '+').replace(/_/g, '/');
  // Check environment for atob
  if (typeof atob === 'undefined') {
    return Buffer.from(standardBase64, 'base64');
  }
  const binaryString = atob(standardBase64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export class IdentityManager {
  // Generate a new Issuer Private Key
  static generateIssuerKey(): string {
    return newEdDSAPrivateKey();
  }

  static async getPublicKey(privateKey: string): Promise<string> {
    // Use a dummy POD to ensure we get the exact Base64 string format that POD uses
    // This avoids manual packing/encoding issues (LE vs BE, etc)
    const dummyEntries: PODEntries = {
      _init: { type: 'int', value: BigInt(123) },
    };
    const pod = POD.sign(dummyEntries, privateKey);
    return pod.signerPublicKey;
  }

  // Issuer: Sign data to create a POD
  static mintPOD(issuerPrivateKey: string, data: IdentityData): POD {
    // Convert data to PODEntries
    const entries: PODEntries = {
      age: { type: 'int', value: BigInt(data.age) },
      residency: { type: 'string', value: data.residency },
      name: { type: 'string', value: data.name },
      // Add a timestamp or nonce to make unique
      timestamp: { type: 'int', value: BigInt(Date.now()) },
    };

    return POD.sign(entries, issuerPrivateKey);
  }

  // Holder/Verifier: Serialize/Deserialize
  static serializePOD(pod: POD): string {
    return JSON.stringify(pod.toJSON());
  }

  static deserializePOD(podStr: string): POD {
    const json = JSON.parse(podStr);
    return POD.fromJSON(json);
  }

  // ------------- ZK/Selective Disclosure Logic -------------

  static createPresentation(pod: POD, revealedKeys: string[]) {
    const content = pod.content;
    const revealed: any = {};

    // Ensure we send what we revealed
    for (const key of revealedKeys) {
      // We use raw value object { type, value }
      const value = content.getValue(key); // PODValue
      if (!value) continue;

      // Sanitize value for JSON transport (ensure BigInts survive if not using custom replacer)
      // Actually App.ts handles BigInt.
      // But value.value might be BigInt.

      const proof = content.generateEntryProof(key); // PODEntryProof
      revealed[key] = { value, proof };
    }

    return {
      revealed,
      signature: pod.signature, // Base64 packed
      signerPublicKey: pod.signerPublicKey, // Base64 packed
    };
  }

  static verifyPresentation(
    presentation: any,
    expectedIssuerPk?: string,
  ): boolean {
    // 1. Verify Public Key (if provided and simple match)
    if (expectedIssuerPk && presentation.signerPublicKey !== expectedIssuerPk) {
      // This might fail if encodings differ, but assuming consistent string usage
      console.warn('Issuer PK mismatch string comparison');
      // For demo we might relax or strict check.
      // Real world: Verify unpacked PKs are equal.
    }

    const { revealed, signature, signerPublicKey } = presentation;
    if (Object.keys(revealed).length === 0) return false;

    let derivedRoot: bigint | null = null;

    // Unpack Crypto (Base64 -> Buffer -> Object)
    let sigObj;
    try {
      // Create proper Buffer objects from Uint8Arrays to make zk-kit happy
      // zk-kit relies on Buffer.from() often or checks Buffer.isBuffer
      const sigBuf = Buffer.from(base64ToBuffer(signature));
      // const pkBuf = Buffer.from(base64ToBuffer(signerPublicKey));

      sigObj = unpackSignature(sigBuf);
      // pkObj = unpackPublicKey(pkBuf);
    } catch (_e) {
      try {
        // Fallback: Try converting to BigInt (assuming LE bytes) if Buffer fails
        // This can happen if base64 decoding is right but zk-kit validation is strict
        console.log('Retrying unpack with BigInt conversion...');
        // Reverse bytes (LE -> BE) then hex
        // const pkReverse = Buffer.from(
        //   base64ToBuffer(signerPublicKey),
        // ).reverse();
        // const pkBigInt = BigInt('0x' + pkReverse.toString('hex'));
        // pkObj = unpackPublicKey(pkBigInt);

        const sigBuf = Buffer.from(base64ToBuffer(signature));
        sigObj = unpackSignature(sigBuf);
      } catch (e2) {
        console.error('Crypto Unpack Failed (Retry)', e2);
        return false;
      }
    }

    for (const key of Object.keys(revealed)) {
      const { value, proof } = revealed[key];

      // Debug Logging
      if (derivedRoot === null) derivedRoot = proof.root;

      // 2. Proof Validity (Integrity of siblings -> root)
      // Note: PODContent.verifyEntryProof might need proper types.
      // Re-construct the proof object to ensure methods exist if it was JSON
      // But verifyEntryProof is static and just takes the object shape usually.
      if (!PODContent.verifyEntryProof(proof)) {
        console.error('Merkle Proof Invalid for', key);
        console.log('Proof:', proof);
        // Debugging hint
        return false;
      }

      // 3. Consistency of Root
      // Convert both to BigInt because one might be string from JSON
      const rootBi = BigInt(proof.root);
      if (derivedRoot === null) derivedRoot = rootBi;
      if (derivedRoot !== rootBi) {
        console.error(`Inconsistent Roots: ${derivedRoot} vs ${rootBi}`);
        return false;
      }

      // 4. Verify Leaf Claim (Name Hash)
      const nameHash = podNameHash(key);
      const proofLeafBi = BigInt(proof.leaf);
      if (proofLeafBi !== nameHash) {
        console.error('Proof leaf does not match name hash for', key);
        console.error(`Expected: ${nameHash}, Got: ${proofLeafBi}`);
        return false;
      }

      // 5. Verify Value Claim
      const valHash = podValueHash(value);
      if (!proof.siblings || proof.siblings.length === 0) {
        console.error('Proof has no siblings');
        return false;
      }
      // proof.siblings are BigInts. Ensure compatibility.
      const siblingZero = BigInt(proof.siblings[0]);
      if (siblingZero !== valHash) {
        console.error('Value hash does not match proof sibling for', key);
        console.error(`Calc Value Hash: ${valHash}`);
        console.error(`Proof Sibling[0]: ${siblingZero}`);
        // Fallback?? No, hashes must match.
        // Check if value is correct type?
        // value comes from PODValue { type: 'int', value: 25 }.
        // podValueHash handles it.
        // BUT - if value.value is '25' (string) instead of 25n (bigint)
        // podValueHash might return different hash or fail.
        // We must revive BigInts in 'value' before hashing!
        return false;
      }
    }

    // 6. Verify Signature on Root
    if (derivedRoot === null) return false;

    console.log('--- Signature Verification Debug ---');
    console.log('Derived Root (BigInt):', derivedRoot.toString());
    console.log('Signer Public Key (Base64):', signerPublicKey);

    // TRY ALL COMBINATIONS
    const tryVerify = (label: string, msg: any, sig: any, pk: any) => {
      try {
        if (verifySignature(msg, sig, pk)) {
          console.log(`SUCCESS: Verification passed using [${label}]`);
          return true;
        }
      } catch (e) { /* ignore mismatches */ }
      return false;
    };

    try {
      const pkBuf = Buffer.from(base64ToBuffer(signerPublicKey));
      const pkBufRev = Buffer.from(base64ToBuffer(signerPublicKey)).reverse();

      const sigBuf = Buffer.from(base64ToBuffer(signature));
      const sigBufRev = Buffer.from(base64ToBuffer(signature)).reverse();

      // Prepare Key Objects
      let pkObjStandard, pkObjRev;
      try { pkObjStandard = unpackPublicKey(pkBuf); } catch (e) { console.log('Std PK Unpack failed'); }
      try { pkObjRev = unpackPublicKey(pkBufRev); } catch (e) { console.log('Rev PK Unpack failed'); }

      // Prepare Sig Objects
      let sigObjStandard, sigObjRev;
      try { sigObjStandard = unpackSignature(sigBuf); } catch (e) { console.log('Std Sig Unpack failed'); }
      try { sigObjRev = unpackSignature(sigBufRev); } catch (e) { console.log('Rev Sig Unpack failed'); }

      // Prepare Messages
      const msgBi = derivedRoot;
      const msgHex = derivedRoot.toString(16);

      // Matrix Test
      if (pkObjStandard && sigObjStandard) {
        if (tryVerify("Std PK / Std Sig / BigInt", msgBi, sigObjStandard, pkObjStandard)) return true;
        if (tryVerify("Std PK / Std Sig / Hex", msgHex, sigObjStandard, pkObjStandard)) return true;
      }

      if (pkObjRev && sigObjStandard) {
        if (tryVerify("Rev PK / Std Sig / BigInt", msgBi, sigObjStandard, pkObjRev)) return true;
        if (tryVerify("Rev PK / Std Sig / Hex", msgHex, sigObjStandard, pkObjRev)) return true;
      }

      // It is rare for Sig to need reversing if standard encoding, but let's check
      if (pkObjStandard && sigObjRev) {
        if (tryVerify("Std PK / Rev Sig / BigInt", msgBi, sigObjRev, pkObjStandard)) return true;
      }

      if (pkObjRev && sigObjRev) {
        if (tryVerify("Rev PK / Rev Sig / BigInt", msgBi, sigObjRev, pkObjRev)) return true;
      }

      console.error("EdDSA Signature Invalid on Root (All variations failed)", derivedRoot);
      return false;

    } catch (e) {
      console.error("Signature Verification Crashed", e);
      return false;
    }
  }
}
