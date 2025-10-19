'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { collection, onSnapshot, doc, DocumentData, query, writeBatch, getDocs, FirestoreError, CollectionReference, Query, getDoc } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { Employee, ProductionItem, ProductionEntry, Team } from '@/lib/types';
import { addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
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
    const path = ref.type === 'collection'
        ? (ref as CollectionReference).path
        : (ref as unknown as InternalQuery)._query.path.canonicalString();

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

  const createInitialProductionEntries = useCallback(async (employeeId: string, teamId: string) => {
    if (!firestore) return;
    const teamItems = items.filter(i => i.teamId === teamId);
    if (teamItems.length === 0) {
      console.log("No items found for team, skipping initial production entries.");
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
    
    batch.commit().catch(e => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            operation: 'write',
            path: `teams/${teamId}/employees/${employeeId}/dailyProduction`,
            requestResourceData: 'Batched initial production entries'
        }));
    });
  }, [firestore, items]);

  useEffect(() => {
    if (!firestore) return;

    let isMounted = true;
    let unsubscribes: (() => void)[] = [];
    setLoading(true);

    const setupInitialData = async () => {
      const teamsRef = collection(firestore, 'teams');
      try {
        const teamsQuery = query(teamsRef);
        const teamsSnap = await getDocs(teamsQuery);
        
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
          await batch.commit();
          console.log("Initial data created.");
        }
      } catch (e) {
        if (e instanceof FirestoreError) {
            handleSnapshotError(e, teamsRef);
        }
        console.error("Error setting up initial data:", e);
      }
    };
    
    const initializeAndListen = async () => {
        await setupInitialData();
        if (!isMounted) return;

        const teamsQuery = query(collection(firestore, 'teams'));
        
        const teamsUnsub = onSnapshot(teamsQuery, (teamsSnapshot) => {
            if (!isMounted) return;
            const teamsData = teamsSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as Team));
            setTeams(teamsData);

            unsubscribes.forEach(unsub => unsub());
            unsubscribes = [];

            if (teamsData.length === 0) {
              setItems([]);
              setEmployees([]);
              setProduction([]);
              setLoading(false);
              return;
            }

            let loadedCount = 0;
            const totalToLoad = teamsData.length * 2; // items and employees for each team

            const allItems: ProductionItem[] = [];
            const allEmployees: Employee[] = [];
            const allProduction: ProductionEntry[] = [];
            
            teamsData.forEach(team => {
                // Listen to Items
                const itemsQuery = query(collection(firestore, `teams/${team.id}/productionItems`));
                const itemsUnsub = onSnapshot(itemsQuery, itemsSnapshot => {
                    if (!isMounted) return;
                    const teamItems = itemsSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as ProductionItem));
                    allItems.push(...teamItems);
                    setItems(prev => [...prev.filter(i => i.teamId !== team.id), ...teamItems]);
                    if (++loadedCount >= totalToLoad) setLoading(false);
                }, error => handleSnapshotError(error, itemsQuery));
                unsubscribes.push(itemsUnsub);

                // Listen to Employees
                const employeesQuery = query(collection(firestore, `teams/${team.id}/employees`));
                const employeesUnsub = onSnapshot(employeesQuery, employeesSnapshot => {
                    if (!isMounted) return;
                    const teamEmployees = employeesSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as Employee));
                    allEmployees.push(...teamEmployees);
                    setEmployees(prev => [...prev.filter(e => e.teamId !== team.id), ...teamEmployees]);
                    
                    teamEmployees.forEach(employee => {
                        const productionQuery = query(collection(firestore, `teams/${team.id}/employees/${employee.id}/dailyProduction`));
                        const productionUnsub = onSnapshot(productionQuery, productionSnapshot => {
                            if (!isMounted) return;
                            const empProduction = productionSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as ProductionEntry));
                            allProduction.push(...empProduction);
                            setProduction(prev => [...prev.filter(p => p.employeeId !== employee.id), ...empProduction]);
                        }, error => handleSnapshotError(error, productionQuery));
                        unsubscribes.push(productionUnsub);
                    });
                    
                    if (++loadedCount >= totalToLoad) setLoading(false);
                }, error => handleSnapshotError(error, employeesQuery));
                unsubscribes.push(employeesUnsub);
            });
        }, (error) => {
            if (isMounted) {
                handleSnapshotError(error, teamsQuery);
                setLoading(false);
            }
        });

        unsubscribes.push(teamsUnsub);
    };

    initializeAndListen();

    return () => {
        isMounted = false;
        unsubscribes.forEach(unsub => unsub());
    };
  }, [firestore]);
  

  const addEmployee = async (employee: Omit<Employee, 'id'>) => {
    if (!firestore) return;
    const ref = collection(firestore, `teams/${employee.teamId}/employees`);
    try {
        const newDocRef = await addDocumentNonBlocking(ref, employee);
        if (newDocRef) {
          // After employee is added, create their production entries for the week
          await createInitialProductionEntries(newDocRef.id, employee.teamId);
        }
    } catch(e) {
      // Error is handled by non-blocking update
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
    // For simplicity, this is left out in this migration. A better data model might be needed.
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
