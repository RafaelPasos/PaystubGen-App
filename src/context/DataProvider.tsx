'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { collection, onSnapshot, doc, writeBatch, getDocs, FirestoreError, query, addDoc, deleteDoc, Unsubscribe } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { Employee, ProductionItem, ProductionEntry, Team } from '@/lib/types';
import { startOfWeek, formatISO, eachDayOfInterval } from 'date-fns';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { getDocsFromServerNonBlocking } from '@/firebase/non-blocking-updates';


interface DataContextType {
  teams: Team[];
  employees: Employee[];
  items: ProductionItem[];
  production: ProductionEntry[];
  loading: boolean;
  addEmployee: (employee: Omit<Employee, 'id'>) => Promise<void>;
  deleteEmployee: (id: string, teamId: string) => Promise<void>;
  
  localRates: Record<string, number>;
  localProduction: Record<string, ProductionEntry>;
  hasChanges: boolean;

  handleRateChange: (itemId: string, newRate: string) => void;
  handleProductionChange: (employeeId: string, itemId: string, dayIndex: number, value: string) => void;
  saveAllChanges: () => Promise<void>;
  resetProduction: () => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

const defaultTeams = [
    { name: "Corazones" },
    { name: "Hojas" }
];

const defaultItems: Record<string, Omit<ProductionItem, 'id' | 'teamId'>[]> = {
  "Corazones": [
    { name: 'Chico', payRate: 10 },
    { name: 'Mediano', payRate: 12 },
    { name: 'Grande', payRate: 14 },
    { name: 'Mini', payRate: 10 },
  ],
  "Hojas": [
    { name: 'Blanca', payRate: 13 },
    { name: 'Capote', payRate: 8 },
    { name: 'Tira', payRate: 6 },
  ]
};

const handleSnapshotError = (error: FirestoreError, path: string) => {
    const contextualError = new FirestorePermissionError({
        operation: 'list',
        path: path,
    });
    errorEmitter.emit('permission-error', contextualError);
};

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const firestore = useFirestore();
  const [teams, setTeams] = useState<Team[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [items, setItems] = useState<ProductionItem[]>([]);
  const [production, setProduction] = useState<ProductionEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Start of generalized save state ---
  const [localRates, setLocalRates] = useState<Record<string, number>>({});
  const [localProduction, setLocalProduction] = useState<Record<string, ProductionEntry>>({});
  const [hasChanges, setHasChanges] = useState(false);
  
  const handleRateChange = (itemId: string, newRate: string) => {
    setLocalRates(prev => ({ ...prev, [itemId]: parseFloat(newRate) || 0 }));
    setHasChanges(true);
  };
  
  const handleProductionChange = (employeeId: string, itemId: string, dayIndex: number, value: string) => {
    const quantity = parseInt(value, 10);
    const finalQuantity = isNaN(quantity) ? 0 : quantity;

    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }); // Monday
    const date = new Date(weekStart);
    date.setDate(date.getDate() + dayIndex);
    const dateString = formatISO(date, { representation: 'date' });
    
    const existingEntry = Object.values(localProduction).find(p => p.employeeId === employeeId && p.productionItemId === itemId && p.date === dateString);

    if (existingEntry) {
      setLocalProduction(prev => ({
          ...prev,
          [existingEntry.id]: { ...existingEntry, quantity: value === '' ? 0 : finalQuantity }
      }));
    } else {
        const tempId = `new-${employeeId}-${itemId}-${dateString}`;
        const newEntry: ProductionEntry = {
            id: tempId,
            employeeId,
            productionItemId: itemId,
            date: dateString,
            quantity: finalQuantity
        };
        setLocalProduction(prev => ({ ...prev, [tempId]: newEntry }));
    }
    setHasChanges(true);
  };

  const resetProduction = useCallback(() => {
    const updatedProduction: Record<string, ProductionEntry> = {};
    for (const key in localProduction) {
        updatedProduction[key] = {
            ...localProduction[key],
            quantity: 0
        };
    }
    setLocalProduction(updatedProduction);
    setHasChanges(true);
  }, [localProduction]);

  const saveAllChanges = async () => {
    if (!firestore) return;
    const batch = writeBatch(firestore);

    // Rate updates
    Object.entries(localRates).forEach(([id, payRate]) => {
      const originalItem = items.find(i => i.id === id);
      if (originalItem && originalItem.payRate !== payRate) {
        const docRef = doc(firestore, `teams/${originalItem.teamId}/productionItems`, id);
        batch.update(docRef, { payRate });
      }
    });

    // Production updates and additions
    Object.values(localProduction).forEach(entry => {
        const originalEntry = production.find(p => p.id === entry.id);
        const employee = employees.find(e => e.id === entry.employeeId);
        if(!employee) return;

        if (originalEntry) {
            if (originalEntry.quantity !== entry.quantity) {
                const docRef = doc(firestore, `teams/${employee.teamId}/employees/${entry.employeeId}/dailyProduction`, entry.id);
                batch.update(docRef, { quantity: entry.quantity });
            }
        } else if (entry.quantity > 0) { // New entry, only add if quantity is not 0
            const { id, ...newEntry } = entry;
            const docRef = doc(collection(firestore, `teams/${employee.teamId}/employees/${entry.employeeId}/dailyProduction`));
            batch.set(docRef, newEntry);
        }
    });

    try {
        await batch.commit();
        setHasChanges(false);
    } catch(e) {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            operation: 'write',
            path: `batch update`,
            requestResourceData: 'Batch update of rates and production'
        }));
        throw e;
    }
  };

  // When original data changes, update local state
  useEffect(() => {
    const initialRates: Record<string, number> = {};
    items.forEach(item => {
      initialRates[item.id] = item.payRate;
    });
    setLocalRates(initialRates);

    const initialProduction: Record<string, ProductionEntry> = {};
    production.forEach(p => {
        initialProduction[p.id] = { ...p };
    });
    setLocalProduction(initialProduction);
    
    setHasChanges(false);
  }, [items, production]);

  // --- End of generalized save state ---


  const createInitialProductionEntries = useCallback(async (employeeId: string, teamId: string, teamItems: ProductionItem[]) => {
    if (!firestore) return;
    if (teamItems.length === 0) return;

    const batch = writeBatch(firestore);
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 5); 
    const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

    const newEntries: ProductionEntry[] = [];
    
    for (const item of teamItems) {
      for (const date of weekDays) {
        const dateString = formatISO(date, { representation: 'date' });
        
        const newEntryData: Omit<ProductionEntry, 'id'> = {
          employeeId,
          productionItemId: item.id,
          date: dateString,
          quantity: 0
        };
        const docRef = doc(collection(firestore, `teams/${teamId}/employees/${employeeId}/dailyProduction`));
        batch.set(docRef, newEntryData);
        newEntries.push({ ...newEntryData, id: docRef.id });
      }
    }
    
    try {
        await batch.commit();
        setProduction(prev => [...prev, ...newEntries]);
        setLocalProduction(prev => {
            const updated = { ...prev };
            newEntries.forEach(entry => {
                updated[entry.id] = entry;
            });
            return updated;
        });
    } catch (e) {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            operation: 'write',
            path: `teams/${teamId}/employees/${employeeId}/dailyProduction`,
            requestResourceData: 'Batched initial production entries'
        }));
        throw e;
    }
  }, [firestore]);


  useEffect(() => {
    if (!firestore) return;

    setLoading(true);

    const teamsQuery = query(collection(firestore, 'teams'));
    const teamsUnsub = onSnapshot(teamsQuery, async (teamsSnapshot) => {
        const teamsData = teamsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team));
        
        if (teamsData.length === 0) {
            const teamsSnap = await getDocsFromServerNonBlocking(collection(firestore, 'teams'));
            if (teamsSnap.empty) {
                const batch = writeBatch(firestore);
                for (const teamData of defaultTeams) {
                    const teamRef = doc(collection(firestore, 'teams'));
                    batch.set(teamRef, teamData);
                    const teamItems = defaultItems[teamData.name] || [];
                    const itemsRef = collection(firestore, `teams/${teamRef.id}/productionItems`);
                    teamItems.forEach(item => {
                        const newItemRef = doc(itemsRef);
                        batch.set(newItemRef, { ...item, teamId: teamRef.id });
                    });
                }
                await batch.commit().catch(e => {
                    errorEmitter.emit('permission-error', new FirestorePermissionError({
                        operation: 'write',
                        path: 'teams',
                        requestResourceData: 'Initial teams and items batch write'
                    }));
                });
            } else {
              setTeams(teamsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team)));
            }
            setLoading(false);
        } else {
            setTeams(teamsData);
            setLoading(false);
        }
    }, (err) => {
        handleSnapshotError(err, 'teams');
        setLoading(false);
    });

    return () => {
      teamsUnsub();
    };
  }, [firestore]);

  useEffect(() => {
    if (!firestore || teams.length === 0) {
      setEmployees([]);
      setItems([]);
      setProduction([]);
      return;
    };

    const unsubscribers: Unsubscribe[] = [];

    const fetchAllData = async () => {
      setLoading(true);

      try {
        const itemPromises = teams.map(team => getDocs(collection(firestore, `teams/${team.id}/productionItems`)));
        const itemSnapshots = await Promise.all(itemPromises);
        const allItems = itemSnapshots.flatMap(snap => snap.docs.map(d => ({id: d.id, ...d.data()} as ProductionItem)));
        setItems(allItems);

        const employeePromises = teams.map(team => getDocs(collection(firestore, `teams/${team.id}/employees`)));
        const employeeSnapshots = await Promise.all(employeePromises);
        const allEmployees = employeeSnapshots.flatMap(snap => snap.docs.map(d => ({id: d.id, ...d.data()} as Employee)));
        
        const uniqueEmployees = Array.from(new Map(allEmployees.map(e => [e.id, e])).values());
        setEmployees(uniqueEmployees);


        if (uniqueEmployees.length > 0) {
          const productionPromises = uniqueEmployees.map(emp => getDocs(collection(firestore, `teams/${emp.teamId}/employees/${emp.id}/dailyProduction`)));
          const productionSnapshots = await Promise.all(productionPromises);
          const allProduction = productionSnapshots.flatMap(snap => snap.docs.map(d => ({id: d.id, ...d.data()} as ProductionEntry)));
          setProduction(allProduction);
        } else {
          setProduction([]);
        }

      } catch (error) {
        console.error("Error fetching initial data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAllData();

    // Set up listeners for real-time updates
    teams.forEach(team => {
      const empQuery = query(collection(firestore, `teams/${team.id}/employees`));
      const empUnsub = onSnapshot(empQuery, (empSnapshot) => {
        const teamEmployees = empSnapshot.docs.map(d => ({id: d.id, ...d.data()} as Employee));
        
        setEmployees(prev => {
          const otherTeamsEmployees = prev.filter(e => e.teamId !== team.id);
          const updatedEmployees = [...otherTeamsEmployees, ...teamEmployees];
          return Array.from(new Map(updatedEmployees.map(e => [e.id, e])).values());
        });

        empSnapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
                const newEmpId = change.doc.id;
                const prodQuery = query(collection(firestore, `teams/${team.id}/employees/${newEmpId}/dailyProduction`));
                const prodUnsub = onSnapshot(prodQuery, (prodSnapshot) => {
                    const empProduction = prodSnapshot.docs.map(d => ({id: d.id, ...d.data()} as ProductionEntry));
                    setProduction(prev => {
                        const otherEmpProduction = prev.filter(p => p.employeeId !== newEmpId);
                        return [...otherEmpProduction, ...empProduction];
                    });
                }, err => handleSnapshotError(err, `teams/${team.id}/employees/${newEmpId}/dailyProduction`));
                unsubscribers.push(prodUnsub);
            }
             if (change.type === 'removed') {
                const removedEmpId = change.doc.id;
                setProduction(prev => prev.filter(p => p.employeeId !== removedEmpId));
            }
        });
        
      }, err => handleSnapshotError(err, `teams/${team.id}/employees`));
      unsubscribers.push(empUnsub);
    });

    return () => unsubscribers.forEach(unsub => unsub());

  }, [firestore, teams]);


  const addEmployee = async (employee: Omit<Employee, 'id'>) => {
    if (!firestore) return;
    const ref = collection(firestore, `teams/${employee.teamId}/employees`);
    try {
      const teamItems = items.filter(i => i.teamId === employee.teamId);
      const newDocRef = await addDoc(ref, employee).catch(e => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            operation: 'create',
            path: ref.path,
            requestResourceData: employee,
        }));
        throw e;
      });

      // The listener will pick up the change, but we can optimistically update for faster UI response
      const newEmployee = { id: newDocRef.id, ...employee };
      setEmployees(prev => [...prev, newEmployee]);

      await createInitialProductionEntries(newDocRef.id, employee.teamId, teamItems);
    } catch (e) {
      if (!(e instanceof FirestorePermissionError)) {
          console.error("Error adding employee:", e);
      }
    }
  };

  const deleteEmployee = async (id: string, teamId: string) => {
    if (!firestore) return;

    // Optimistic update
    setEmployees(prev => prev.filter(e => e.id !== id));
    setProduction(prev => prev.filter(p => p.employeeId !== id));

    const ref = doc(firestore, `teams/${teamId}/employees`, id);
    
    try {
        const productionQuery = query(collection(ref, 'dailyProduction'));
        const productionSnap = await getDocs(productionQuery);
        const batch = writeBatch(firestore);
        productionSnap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        await deleteDoc(ref);
    } catch(e) {
        console.error("Error deleting employee and their production:", e);
        // On failure, the listener should eventually correct the state, but a manual rollback could be implemented here if needed.
         errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: ref.path,
            operation: 'delete',
         }));
    }
  };

  const value = {
    teams,
    employees,
    items,
    production,
    loading,
    addEmployee,
    deleteEmployee,
    localRates,
    localProduction,
    hasChanges,
    handleRateChange,
    handleProductionChange,
    saveAllChanges,
    resetProduction,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const useData = () => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};

    