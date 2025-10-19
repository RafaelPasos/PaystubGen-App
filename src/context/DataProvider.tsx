'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { collection, onSnapshot, doc, DocumentData, query, writeBatch, getDocs, FirestoreError, CollectionReference, Query, getDoc, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { Employee, ProductionItem, ProductionEntry, Team } from '@/lib/types';
import { getDocsFromServerNonBlocking } from '@/firebase/non-blocking-updates';
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

const handleSnapshotError = (error: FirestoreError, ref: CollectionReference | Query) => {
    let path: string;
    if (ref.type === 'collection') {
        path = (ref as CollectionReference).path;
    } else {
        // This is a simplified way to get path from a query
        path = (ref as any)._query.path.segments.join('/');
    }

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
    if (teamItems.length === 0) {
      return;
    }

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
    let unsubscribes: (() => void)[] = [];

    const setupInitialData = async () => {
      const teamsRef = collection(firestore, 'teams');
      const teamsSnap = await getDocsFromServerNonBlocking(teamsRef);
      
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

    const listenToData = async () => {
        setLoading(true);
        try {
            await setupInitialData();
        } catch (error) {
            console.error("Error setting up initial data:", error);
            if (isMounted) setLoading(false);
            return;
        }

        if (!isMounted) return;
       
        const teamsQuery = query(collection(firestore, 'teams'));
        const teamsUnsub = onSnapshot(teamsQuery, async (teamsSnapshot) => {
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

            // Clean up old listeners before setting up new ones
            unsubscribes.forEach(unsub => unsub());
            unsubscribes = [];

            const teamPromises = teamsData.map(team => {
                return new Promise((resolveTeam) => {
                    const teamItems: ProductionItem[] = [];
                    const teamEmployees: Employee[] = [];
                    const teamProduction: ProductionEntry[] = [];
                    
                    const itemsQuery = query(collection(firestore, `teams/${team.id}/productionItems`));
                    const itemsUnsub = onSnapshot(itemsQuery, (itemsSnapshot) => {
                        itemsSnapshot.docs.forEach(doc => {
                           const itemIndex = teamItems.findIndex(i => i.id === doc.id);
                            if (itemIndex > -1) teamItems[itemIndex] = { id: doc.id, ...doc.data() } as ProductionItem;
                            else teamItems.push({ id: doc.id, ...doc.data() } as ProductionItem);
                        });
                    }, err => handleSnapshotError(err, itemsQuery));
                    unsubscribes.push(itemsUnsub);

                    const employeesQuery = query(collection(firestore, `teams/${team.id}/employees`));
                    const employeesUnsub = onSnapshot(employeesQuery, (employeesSnapshot) => {
                        const employeePromises = employeesSnapshot.docs.map(empDoc => {
                            return new Promise((resolveEmployee) => {
                                const employeeIndex = teamEmployees.findIndex(e => e.id === empDoc.id);
                                if (employeeIndex > -1) teamEmployees[employeeIndex] = { id: empDoc.id, ...empDoc.data() } as Employee;
                                else teamEmployees.push({ id: empDoc.id, ...empDoc.data() } as Employee);
                                
                                const productionQuery = query(collection(firestore, `teams/${team.id}/employees/${empDoc.id}/dailyProduction`));
                                const productionUnsub = onSnapshot(productionQuery, (productionSnapshot) => {
                                    productionSnapshot.docs.forEach(prodDoc => {
                                        const prodIndex = teamProduction.findIndex(p => p.id === prodDoc.id);
                                        if (prodIndex > -1) teamProduction[prodIndex] = { id: prodDoc.id, ...prodDoc.data() } as ProductionEntry;
                                        else teamProduction.push({ id: prodDoc.id, ...prodDoc.data() } as ProductionEntry);
                                    });
                                    resolveEmployee(true);
                                }, err => handleSnapshotError(err, productionQuery));
                                unsubscribes.push(productionUnsub);
                            });
                        });
                        Promise.all(employeePromises).then(() => resolveTeam({ items: teamItems, employees: teamEmployees, production: teamProduction }));
                    }, err => handleSnapshotError(err, employeesQuery));
                    unsubscribes.push(employeesUnsub);
                });
            });

            const allData = await Promise.all(teamsData.map(team => {
                return new Promise<{items: ProductionItem[], employees: Employee[], production: ProductionEntry[]}>((resolve, reject) => {
                    const itemsQuery = query(collection(firestore, 'teams', team.id, 'productionItems'));
                    const employeesQuery = query(collection(firestore, 'teams', team.id, 'employees'));

                    const itemsUnsub = onSnapshot(itemsQuery, itemsSnap => {
                        const currentItems = itemsSnap.docs.map(d => ({id: d.id, ...d.data()}) as ProductionItem);
                        
                        const employeesUnsub = onSnapshot(employeesQuery, employeesSnap => {
                            const currentEmployees = employeesSnap.docs.map(d => ({id: d.id, ...d.data()}) as Employee);
                            
                            if (currentEmployees.length === 0) {
                                resolve({items: currentItems, employees: [], production: []});
                                return;
                            }

                            const productionPromises = currentEmployees.map(emp => {
                                return new Promise<ProductionEntry[]>(resolveProd => {
                                    const prodQuery = query(collection(firestore, 'teams', team.id, 'employees', emp.id, 'dailyProduction'));
                                    const prodUnsub = onSnapshot(prodQuery, prodSnap => {
                                        const currentProduction = prodSnap.docs.map(d => ({id: d.id, ...d.data()}) as ProductionEntry);
                                        resolveProd(currentProduction);
                                        prodUnsub(); // One-shot listener for this pattern
                                    }, err => handleSnapshotError(err, prodQuery));
                                });
                            });

                            Promise.all(productionPromises).then(allProd => {
                                resolve({items: currentItems, employees: currentEmployees, production: allProd.flat()});
                            });
                        }, err => handleSnapshotError(err, employeesQuery));
                        unsubscribes.push(employeesUnsub);
                    }, err => handleSnapshotError(err, itemsQuery));
                    unsubscribes.push(itemsUnsub);
                });
            }));
            
            if (isMounted) {
                setItems(allData.flatMap(d => d.items));
                setEmployees(allData.flatMap(d => d.employees));
                setProduction(allData.flatMap(d => d.production));
                setLoading(false);
            }

        }, (err) => handleSnapshotError(err, teamsQuery));

        unsubscribes.push(teamsUnsub);
    };

    listenToData();

    return () => {
      isMounted = false;
      unsubscribes.forEach(unsub => unsub());
    };
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
    
    // Also delete subcollections
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
