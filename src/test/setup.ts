import Dexie from 'dexie';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

// Runs before any test module (and before Database.ts creates the Dexie
// singleton), so the in-memory IndexedDB is in place from the start.
Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
