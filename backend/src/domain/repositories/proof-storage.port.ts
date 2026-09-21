/**
 * PaymentProofStorage port (Prompt 50, REQ-118).
 *
 * Proof bytes are staged/integrated behind an adapter so the domain never
 * touches the physical backing layer. Keys are opaque, namespaced per business,
 * and customers/owners never see them (doc 31 §5).
 */
export interface StoredProof {
  /** Opaque storage key (per-business namespace). */
  storageKey: string;
  checksumSha256: string;
  sizeBytes: number;
}

export interface StoredProofContent {
  bytes: Buffer;
}

export interface PaymentProofStorage {
  /** Persist proof bytes. Returns the metadata row (key, checksum, size). */
  store(input: { businessId: string; bytes: Buffer; mimeType: string; extension: string }): Promise<StoredProof>;
  /** Read proof bytes by storage key. Null when the object no longer exists. */
  read(storageKey: string): Promise<StoredProofContent | null>;
  /** Best-effort, idempotent delete (missing object is not an error). */
  delete(storageKey: string): Promise<void>;
}