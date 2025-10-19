'use client';
    
import {
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  CollectionReference,
  DocumentReference,
  SetOptions,
  writeBatch,
  getDocsFromServer,
  Firestore,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import {FirestorePermissionError} from '@/firebase/errors';

/**
 * Initiates a setDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function setDocumentNonBlocking(docRef: DocumentReference, data: any, options?: SetOptions) {
  const promise = options ? setDoc(docRef, data, options) : setDoc(docRef, data);
  promise.catch(error => {
    errorEmitter.emit(
      'permission-error',
      new FirestorePermissionError({
        path: docRef.path,
        operation: options && 'merge' in options ? 'update' : 'create',
        requestResourceData: data,
      })
    )
  })
}


/**
 * Initiates an addDoc operation for a collection reference.
 * Does NOT await the write operation internally.
 * Returns the Promise for the new doc ref, but typically not awaited by caller.
 */
export function addDocumentNonBlocking(colRef: CollectionReference, data: any) {
  const promise = addDoc(colRef, data)
    promise.catch(error => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: colRef.path,
          operation: 'create',
          requestResourceData: data,
        })
      )
    });
  return promise;
}


/**
 * Initiates an updateDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function updateDocumentNonBlocking(docRef: DocumentReference, data: any) {
  updateDoc(docRef, data)
    .catch(error => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'update',
          requestResourceData: data,
        })
      )
    });
}


/**
 * Initiates a deleteDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function deleteDocumentNonBlocking(docRef: DocumentReference) {
  deleteDoc(docRef)
    .catch(error => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'delete',
        })
      )
    });
}

/**
 * Initiates a writeBatch operation.
 * Does NOT await the write operation internally.
 */
export function commitBatchNonBlocking(db: Firestore, operations: (batch: ReturnType<typeof writeBatch>) => void) {
    const batch = writeBatch(db);
    operations(batch);
    batch.commit().catch(error => {
        // Batch writes don't have a single path, so we use a generic path.
        // The detailed error from the emulator will still be very helpful.
        errorEmitter.emit(
            'permission-error',
            new FirestorePermissionError({
                path: 'batch-write',
                operation: 'write',
            })
        );
    });
}

/**
 * Initiates a getDocsFromServer operation.
 * Wraps in a try/catch to handle permissions.
 */
export async function getDocsFromServerNonBlocking(query: CollectionReference) {
    try {
        return await getDocsFromServer(query);
    } catch (error) {
        errorEmitter.emit(
            'permission-error',
            new FirestorePermissionError({
                path: query.path,
                operation: 'list',
            })
        );
        // Return an empty-like structure or re-throw a custom error
        return { docs: [], empty: true, size: 0, forEach: () => {}, ...Promise.resolve() };
    }
}
