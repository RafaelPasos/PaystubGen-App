'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, DocumentData, query, writeBatch, getDocs, where, CollectionReference, Query, FirestoreError } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { Employee, ProductionItem, ProductionEntry, Team } from '@/lib/types';
import { useToast } from "@/hooks/use-toast"
import { addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { startOfWeek, formatISO } from 'date-fns';
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
  const { toast } = useToast();

  const createInitialProductionEntries = async (employeeId: string, teamId: string, teamItems: ProductionItem[]) => {
    if (!firestore) return;
    const batch = writeBatch(firestore);
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }); // Monday

    for (const item of teamItems) {
        for (let i = 0; i < 6; i++) {
            const date = new Date(weekStart);
            date.setDate(date.getDate() + i);
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
  };

  useEffect(() => {
    if (!firestore) return;

    let isMounted = true;
    let unsubscribes: (() => void)[] = [];

    const setupInitialData = async () => {
      const teamsRef = collection(firestore, 'teams');
      try {
        const teamsSnap = await getDocs(teamsRef);
        if (teamsSnap.empty) {
          console.log("No teams found, creating initial data...");
          const batch = writeBatch(firestore);
          const teamRefs: {id: string, name: string}[] = [];

          for (const team of defaultTeams) {
              const teamRef = doc(teamsRef);
              batch.set(teamRef, team);
              teamRefs.push({id: teamRef.id, name: team.name});
          }

          for (const teamRef of teamRefs) {
              const teamItems = defaultItems[teamRef.name] || [];
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

        setLoading(true);
        const teamsQuery = query(collection(firestore, 'teams'));
        
        const teamsUnsub = onSnapshot(teamsQuery, (teamsSnapshot) => {
            const teamsData = teamsSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as Team));
            setTeams(teamsData);

            // Clean up old listeners
            unsubscribes.forEach(unsub => unsub());
            unsubscribes = [];

            let allEmployees: Employee[] = [];
            let allItems: ProductionItem[] = [];
            let allProduction: ProductionEntry[] = [];
            
            if (teamsData.length === 0) {
              setEmployees([]);
              setItems([]);
              setProduction([]);
              setLoading(false);
              return;
            }

            let teamsProcessed = 0;
            
            teamsData.forEach(team => {
                const itemsQuery = query(collection(firestore, `teams/${team.id}/productionItems`));
                const itemsUnsub = onSnapshot(itemsQuery, itemsSnapshot => {
                    const teamItems = itemsSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as ProductionItem));
                    // Filter out old items for this team and add new ones
                    allItems = [...allItems.filter(i => i.teamId !== team.id), ...teamItems];
                    setItems(allItems);
                }, error => handleSnapshotError(error, itemsQuery));
                unsubscribes.push(itemsUnsub);

                const employeesQuery = query(collection(firestore, `teams/${team.id}/employees`));
                const employeesUnsub = onSnapshot(employeesQuery, employeesSnapshot => {
                    const teamEmployees = employeesSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as Employee));
                    // Filter out old employees for this team and add new ones
                    allEmployees = [...allEmployees.filter(e => e.teamId !== team.id), ...teamEmployees];
                    setEmployees(allEmployees);

                    teamEmployees.forEach(employee => {
                        const productionQuery = query(collection(firestore, `teams/${team.id}/employees/${employee.id}/dailyProduction`));
                        const productionUnsub = onSnapshot(productionQuery, productionSnapshot => {
                            const empProduction = productionSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as ProductionEntry));
                             // Filter out old production for this employee and add new ones
                            allProduction = [...allProduction.filter(p => p.employeeId !== employee.id), ...empProduction];
                            setProduction(allProduction);
                        }, error => handleSnapshotError(error, productionQuery));
                        unsubscribes.push(productionUnsub);
                    });

                    // Remove production data for employees that no longer exist
                    const currentTeamEmpIds = new Set(teamEmployees.map(e => e.id));
                    allProduction = allProduction.filter(p => {
                      const emp = allEmployees.find(e => e.id === p.employeeId);
                      // Keep if employee exists and is in the current team being processed
                      return emp && emp.teamId === team.id ? currentTeamEmpIds.has(p.employeeId) : true;
                    });
                    setProduction(allProduction);

                }, error => handleSnapshotError(error, employeesQuery));
                unsubscribes.push(employeesUnsub);

                teamsProcessed++;
                if (teamsProcessed === teamsData.length) {
                    setLoading(false);
                }
            });
        }, (error) => {
            handleSnapshotError(error, teamsQuery);
            setLoading(false);
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
    addDocumentNonBlocking(ref, employee)
      .then(newDocRef => {
        if (newDocRef) {
          const teamItems = items.filter(item => item.teamId === employee.teamId);
          createInitialProductionEntries(newDocRef.id, employee.teamId, teamItems);
        }
      });
  };

  const updateEmployee = async (id: string, teamId: string, employee: Partial<Employee>) => {
    if (!firestore) return;
    updateDocumentNonBlocking(doc(firestore, `teams/${teamId}/employees`, id), employee as DocumentData);
  };

  const deleteEmployee = async (id: string, teamId: string) => {
    if (!firestore) return;
    // Also delete subcollections if necessary, here just deleting the employee doc
    deleteDocumentNonBlocking(doc(firestore, `teams/${teamId}/employees`, id));
  };

  const addItem = async (item: Omit<ProductionItem, 'id'>) => {
    if (!firestore) return;
    addDocumentNonBlocking(collection(firestore, `teams/${item.teamId}/productionItems`), item as DocumentData);
  };

  const updateItem = async (id: string, teamId: string, item: Partial<ProductionItem>) => {
    if (!firestore) return;
    updateDocumentNonBlocking(doc(firestore, `teams/${teamId}/productionItems`, id), item as DocumentData);
  };

  const deleteItem = async (id: string, teamId: string) => {
    if (!firestore) return;
    deleteDocumentNonBlocking(doc(firestore, `teams/${teamId}/productionItems`, id));
  };

  const addProductionEntry = async (entry: Omit<ProductionEntry, 'id'>) => {
    if (!firestore) return;
    const employee = employees.find(e => e.id === entry.employeeId);
    if (!employee) return;
    addDocumentNonBlocking(collection(firestore, `teams/${employee.teamId}/employees/${entry.employeeId}/dailyProduction`), entry as DocumentData);
  };

  const updateProductionEntry = async (id: string, teamId: string, employeeId: string, entry: Partial<ProductionEntry>) => {
     if (!firestore) return;
     updateDocumentNonBlocking(doc(firestore, `teams/${teamId}/employees/${employeeId}/dailyProduction`, id), entry as DocumentData);
  };

  const deleteProductionEntry = async (id: string) => {
    // This is more complex as we don't know the team/employee from just the production id
    // For simplicity, this is left out in this migration. A better data model might be needed.
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
