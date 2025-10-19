'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { collection, onSnapshot, doc, DocumentData, query, writeBatch, getDocs, FirestoreError, CollectionReference, Query, getDoc, addDoc } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { Employee, ProductionItem, ProductionEntry, Team } from '@/lib/types';
import { addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, getDocsFromServerNonBlocking } from '@/firebase/non-blocking-updates';
import { startOfWeek, formatISO, eachDayOfInterval } from 'date-fns';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { InternalQuery } from '@/firebase/firestore/use-collection';

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
    // This logic extracts the path from either a ref or a query
    if (ref.type === 'collection') {
        path = (ref as CollectionReference).path;
    } else {
        // This is a workaround to get the path from a query
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
      console.log("No items found for team, skipping initial production entries.");
      return;
    }

    const batch = writeBatch(firestore);
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 5); // Monday to Saturday
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
    const allUnsubscribes: (() => void)[] = [];

    const setupInitialData = async () => {
      const teamsRef = collection(firestore, 'teams');
      const teamsSnap = await getDocsFromServerNonBlocking(teamsRef);
      
      if (teamsSnap.empty) {
        console.log("No teams found, creating initial data...");
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
        });
        console.log("Initial data created.");
      }
    };
    
    const listenToData = async () => {
      await setupInitialData();
      if (!isMounted) return;

      setLoading(true);

      const teamsQuery = query(collection(firestore, 'teams'));
      const teamsUnsub = onSnapshot(teamsQuery, (teamsSnapshot) => {
        if (!isMounted) return;

        const teamsData = teamsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team));
        setTeams(teamsData);

        // Clear old listeners before setting up new ones
        allUnsubscribes.splice(1).forEach(unsub => unsub());

        if (teamsData.length === 0) {
            setItems([]);
            setEmployees([]);
            setProduction([]);
            setLoading(false);
            return;
        }

        let teamsProcessed = 0;
        const allTeamData = {
          items: [] as ProductionItem[],
          employees: [] as Employee[],
          production: [] as ProductionEntry[],
        };

        teamsData.forEach(team => {
            const itemsQuery = query(collection(firestore, `teams/${team.id}/productionItems`));
            const itemUnsub = onSnapshot(itemsQuery, itemsSnapshot => {
                const teamItems = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionItem));
                
                const employeesQuery = query(collection(firestore, `teams/${team.id}/employees`));
                const empUnsub = onSnapshot(employeesQuery, employeesSnapshot => {
                    const teamEmployees = employeesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));

                    const productionUnsubs: (() => void)[] = [];
                    if (teamEmployees.length === 0) {
                        teamsProcessed++;
                        if (teamsProcessed === teamsData.length) {
                            setItems(allTeamData.items);
                            setEmployees(allTeamData.employees);
                            setProduction(allTeamData.production);
                            setLoading(false);
                        }
                        return;
                    }
                    
                    let employeesProcessed = 0;
                    teamEmployees.forEach(employee => {
                        const productionQuery = query(collection(firestore, `teams/${team.id}/employees/${employee.id}/dailyProduction`));
                        const prodUnsub = onSnapshot(productionQuery, productionSnapshot => {
                            const empProduction = productionSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionEntry));
                            
                            // This is complex, needs a better way to merge state without losing data from other listeners
                            // For now, let's try replacing all data for the employee
                            allTeamData.production = [
                                ...allTeamData.production.filter(p => p.employeeId !== employee.id),
                                ...empProduction,
                            ];

                            employeesProcessed++;
                            if (employeesProcessed === teamEmployees.length) {
                                allTeamData.items = [...allTeamData.items.filter(i => i.teamId !== team.id), ...teamItems];
                                allTeamData.employees = [...allTeamData.employees.filter(e => e.teamId !== team.id), ...teamEmployees];
                                
                                teamsProcessed++;
                                if (teamsProcessed === teamsData.length) {
                                    setItems(allTeamData.items);
                                    setEmployees(allTeamData.employees);
                                    setProduction(allTeamData.production);
                                    setLoading(false);
                                }
                            }
                        }, err => handleSnapshotError(err, productionQuery));
                        productionUnsubs.push(prodUnsub);
                    });

                    allUnsubscribes.push(...productionUnsubs);
                }, err => handleSnapshotError(err, employeesQuery));
                allUnsubscribes.push(empUnsub);
            }, err => handleSnapshotError(err, itemsQuery));
            allUnsubscribes.push(itemUnsub);
        });

      }, (err) => handleSnapshotError(err, teamsQuery));

      allUnsubscribes.push(teamsUnsub);
    };

    listenToData();

    return () => {
      isMounted = false;
      allUnsubscribes.forEach(unsub => unsub());
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
    updateDocumentNonBlocking(doc(firestore, `teams/${teamId}/employees`, id), employee);
  };

  const deleteEmployee = async (id: string, teamId: string) => {
    if (!firestore) return;
    deleteDocumentNonBlocking(doc(firestore, `teams/${teamId}/employees`, id));
  };

  const addItem = async (item: Omit<ProductionItem, 'id'>) => {
    if (!firestore) return;
    addDocumentNonBlocking(collection(firestore, `teams/${item.teamId}/productionItems`), item);
  };

  const updateItem = async (id: string, teamId: string, item: Partial<ProductionItem>) => {
    if (!firestore) return;
    updateDocumentNonBlocking(doc(firestore, `teams/${teamId}/productionItems`, id), item);
  };

  const deleteItem = async (id: string, teamId: string) => {
    if (!firestore) return;
    deleteDocumentNonBlocking(doc(firestore, `teams/${teamId}/productionItems`, id));
  };

  const addProductionEntry = async (entry: Omit<ProductionEntry, 'id'>) => {
    if (!firestore) return;
    const employee = employees.find(e => e.id === entry.employeeId);
    if (!employee) return;
    addDocumentNonBlocking(collection(firestore, `teams/${employee.teamId}/employees/${entry.employeeId}/dailyProduction`), entry);
  };

  const updateProductionEntry = async (id: string, teamId: string, employeeId: string, entry: Partial<ProductionEntry>) => {
     if (!firestore) return;
     updateDocumentNonBlocking(doc(firestore, `teams/${teamId}/employees/${employeeId}/dailyProduction`, id), entry);
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

    