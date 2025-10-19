'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { collection, onSnapshot, doc, writeBatch, getDocs, FirestoreError, query, addDoc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { Employee, ProductionItem, ProductionEntry, Team } from '@/lib/types';
import { startOfWeek, formatISO, eachDayOfInterval } from 'date-fns';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

interface DataContextType {
  teams: Team[];
  employees: Employee[];
  items: ProductionItem[];
  production: ProductionEntry[];
  loading: boolean;
  addEmployee: (employee: Omit<Employee, 'id'>) => Promise<void>;
  updateEmployee: (id: string, teamId: string, employee: Partial<Employee>) => Promise<void>;
  deleteEmployee: (id: string, teamId: string) => Promise<void>;
  addItem: (item: Omit<ProductionItem, 'id'>) => Promise<void>;
  updateItem: (id: string, teamId: string, item: Partial<ProductionItem>) => Promise<void>;
  deleteItem: (id: string, teamId: string) => Promise<void>;
  addProductionEntry: (entry: Omit<ProductionEntry, 'id'>) => Promise<void>;
  updateProductionEntry: (id: string, teamId:string, employeeId: string, entry: Partial<ProductionEntry>) => Promise<void>;
  deleteProductionEntry: (id: string) => Promise<void>;
  batchUpdate: (teamId: string, rateUpdates: { id: string, data: Partial<ProductionItem> }[], productionUpdates: { id: string, employeeId: string, data: Partial<ProductionEntry> }[], productionAdditions: Omit<ProductionEntry, 'id'>[]) => Promise<void>;
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

  const createInitialProductionEntries = useCallback(async (employeeId: string, teamId: string, teamItems: ProductionItem[]) => {
    if (!firestore) return;
    if (teamItems.length === 0) return;

    const batch = writeBatch(firestore);
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 5); 
    const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

    for (const item of teamItems) {
      for (const date of weekDays) {
        const dateString = formatISO(date, { representation: 'date' });
        
        const newEntry: Omit<ProductionEntry, 'id'> = {
          employeeId,
          productionItemId: item.id,
          date: dateString,
          quantity: 0
        };
        const docRef = doc(collection(firestore, `teams/${teamId}/employees/${employeeId}/dailyProduction`));
        batch.set(docRef, newEntry);
      }
    }
    
    return batch.commit().catch(e => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            operation: 'write',
            path: `teams/${teamId}/employees/${employeeId}/dailyProduction`,
            requestResourceData: 'Batched initial production entries'
        }));
        throw e;
    });
  }, [firestore]);


  useEffect(() => {
    if (!firestore) return;

    let isMounted = true;
    setLoading(true);

    const setupInitialData = async () => {
        const teamsRef = collection(firestore, 'teams');
        const teamsSnap = await getDocs(teamsRef).catch(e => {
            handleSnapshotError(e, 'teams');
            throw e;
        });

        if (teamsSnap.empty) {
            const batch = writeBatch(firestore);
            for (const teamData of defaultTeams) {
                const teamRef = doc(teamsRef);
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
                throw e;
            });
        }
    };

    setupInitialData().then(() => {
        if (!isMounted) return;

        const teamsQuery = query(collection(firestore, 'teams'));
        const unsubscribe = onSnapshot(teamsQuery, async (teamsSnapshot) => {
            if (!isMounted) return;

            const teamsData = teamsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team));
            setTeams(teamsData);

            if (teamsData.length === 0) {
                setItems([]);
                setEmployees([]);
                setProduction([]);
                setLoading(false);
                return;
            }

            const allItems: ProductionItem[] = [];
            const allEmployees: Employee[] = [];
            const allProduction: ProductionEntry[] = [];

            for (const team of teamsData) {
                const itemsQuery = query(collection(firestore, 'teams', team.id, 'productionItems'));
                const employeesQuery = query(collection(firestore, 'teams', team.id, 'employees'));

                const [itemsSnap, employeesSnap] = await Promise.all([
                    getDocs(itemsQuery).catch(() => ({ docs: [] })),
                    getDocs(employeesQuery).catch(() => ({ docs: [] }))
                ]);

                itemsSnap.docs.forEach(doc => allItems.push({ id: doc.id, ...doc.data() } as ProductionItem));
                employeesSnap.docs.forEach(doc => allEmployees.push({ id: doc.id, ...doc.data() } as Employee));
                
                for (const empDoc of employeesSnap.docs) {
                    const productionQuery = query(collection(firestore, 'teams', team.id, 'employees', empDoc.id, 'dailyProduction'));
                    const productionSnap = await getDocs(productionQuery).catch(() => ({ docs: [] }));
                    productionSnap.docs.forEach(doc => allProduction.push({ id: doc.id, ...doc.data() } as ProductionEntry));
                }
            }

            if (isMounted) {
                setItems(allItems);
                setEmployees(allEmployees);
                setProduction(allProduction);
                setLoading(false);
            }

        }, (err) => {
            handleSnapshotError(err, 'teams');
            if (isMounted) setLoading(false);
        });

        return () => {
            isMounted = false;
            unsubscribe();
        };
    }).catch(err => {
      console.error("Error setting up initial data:", err);
      if (isMounted) setLoading(false);
    });

    return () => { isMounted = false; };
}, [firestore, createInitialProductionEntries]);


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
      await createInitialProductionEntries(newDocRef.id, employee.teamId, teamItems);
    } catch (e) {
      if (!(e instanceof FirestorePermissionError)) {
          console.error("Error adding employee:", e);
      }
    }
  };

  const updateEmployee = async (id: string, teamId: string, employee: Partial<Employee>) => {
    if (!firestore) return;
    const ref = doc(firestore, `teams/${teamId}/employees`, id);
    updateDoc(ref, employee).catch(e => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: ref.path,
            operation: 'update',
            requestResourceData: employee,
        }));
    });
  };

  const deleteEmployee = async (id: string, teamId: string) => {
    if (!firestore) return;
    const ref = doc(firestore, `teams/${teamId}/employees`, id);
    
    const productionQuery = query(collection(ref, 'dailyProduction'));
    const productionSnap = await getDocs(productionQuery);
    const batch = writeBatch(firestore);
    productionSnap.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    deleteDoc(ref).catch(e => {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: ref.path,
        operation: 'delete',
      }));
    });
  };

  const addItem = async (item: Omit<ProductionItem, 'id'>) => {
    if (!firestore) return;
    const ref = collection(firestore, `teams/${item.teamId}/productionItems`);
    addDoc(ref, item).catch(e => {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: ref.path,
        operation: 'create',
        requestResourceData: item,
      }));
    });
  };

  const updateItem = async (id: string, teamId: string, item: Partial<ProductionItem>) => {
    if (!firestore) return;
    const ref = doc(firestore, `teams/${teamId}/productionItems`, id);
    updateDoc(ref, item).catch(e => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: ref.path,
            operation: 'update',
            requestResourceData: item,
        }));
    });
  };

  const deleteItem = async (id: string, teamId: string) => {
    if (!firestore) return;
    const ref = doc(firestore, `teams/${teamId}/productionItems`, id);
    deleteDoc(ref).catch(e => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: ref.path,
            operation: 'delete',
        }));
    });
  };

  const addProductionEntry = async (entry: Omit<ProductionEntry, 'id'>) => {
    if (!firestore) return;
    const employee = employees.find(e => e.id === entry.employeeId);
    if (!employee) return;
    const ref = collection(firestore, `teams/${employee.teamId}/employees/${entry.employeeId}/dailyProduction`);
    addDoc(ref, entry).catch(e => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: ref.path,
            operation: 'create',
            requestResourceData: entry,
        }));
    });
  };

  const updateProductionEntry = async (id: string, teamId: string, employeeId: string, entry: Partial<ProductionEntry>) => {
     if (!firestore) return;
     const ref = doc(firestore, `teams/${teamId}/employees/${employeeId}/dailyProduction`, id);
     updateDoc(ref, entry).catch(e => {
         errorEmitter.emit('permission-error', new FirestorePermissionError({
             path: ref.path,
             operation: 'update',
             requestResourceData: entry,
         }));
     });
  };

  const deleteProductionEntry = async (id: string) => {
    // This is more complex as we don't know the team/employee from just the production id
  };

  const batchUpdate = async (teamId: string, rateUpdates: { id: string, data: Partial<ProductionItem> }[], productionUpdates: { id: string, employeeId: string, data: Partial<ProductionEntry> }[], productionAdditions: Omit<ProductionEntry, 'id'>[]) => {
    if (!firestore) return;
    const batch = writeBatch(firestore);

    rateUpdates.forEach(update => {
        const docRef = doc(firestore, `teams/${teamId}/productionItems`, update.id);
        batch.update(docRef, update.data);
    });

    productionUpdates.forEach(update => {
        const docRef = doc(firestore, `teams/${teamId}/employees/${update.employeeId}/dailyProduction`, update.id);
        batch.update(docRef, update.data);
    });

    productionAdditions.forEach(addition => {
        const docRef = doc(collection(firestore, `teams/${teamId}/employees/${addition.employeeId}/dailyProduction`));
        batch.set(docRef, addition);
    });

    try {
        await batch.commit();
    } catch(e) {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            operation: 'write',
            path: `teams/${teamId} batch update`,
            requestResourceData: 'Batch update of rates and production'
        }));
        throw e;
    }
  };

  const value = {
    teams,
    employees,
    items,
    production,
    loading,
    addEmployee,
    updateEmployee,
    deleteEmployee,
    addItem,
    updateItem,
    deleteItem,
    addProductionEntry,
    updateProductionEntry,
    deleteProductionEntry,
    batchUpdate
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
