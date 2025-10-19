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
    setLoading(true);

    const setupInitialData = async () => {
        const teamsRef = collection(firestore, 'teams');
        try {
            const teamsSnap = await getDocs(teamsRef);
            
            if (teamsSnap.empty) {
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
            }
        } catch (e) {
             if (e instanceof FirestoreError) {
                handleSnapshotError(e, teamsRef);
            }
        }
    };

    const teamsRef = collection(firestore, 'teams');
    const unsubTeams = onSnapshot(teamsRef, async (snapshot) => {
      const teamsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team));
      setTeams(teamsData);
      
      if (teamsData.length > 0) {
        const allUnsubs: (()=>void)[] = [];

        teamsData.forEach(team => {
            const employeesRef = collection(firestore, `teams/${team.id}/employees`);
            const itemsRef = collection(firestore, `teams/${team.id}/productionItems`);
            
            const unsubEmployees = onSnapshot(employeesRef, empSnap => {
                const teamEmployees = empSnap.docs.map(d => ({ id: d.id, ...d.data() } as Employee));
                setEmployees(prev => [...prev.filter(e => e.teamId !== team.id), ...teamEmployees]);
                
                teamEmployees.forEach(emp => {
                    const prodRef = collection(firestore, `teams/${team.id}/employees/${emp.id}/dailyProduction`);
                    const unsubProd = onSnapshot(prodRef, prodSnap => {
                        const empProduction = prodSnap.docs.map(p => ({ id: p.id, ...p.data() } as ProductionEntry));
                        setProduction(prev => [...prev.filter(p => p.employeeId !== emp.id), ...empProduction]);
                    }, (error) => handleSnapshotError(error, prodRef));
                    allUnsubs.push(unsubProd);
                });

            }, (error) => handleSnapshotError(error, employeesRef));
            allUnsubs.push(unsubEmployees);

            const unsubItems = onSnapshot(itemsRef, itemSnap => {
                const teamItems = itemSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionItem));
                setItems(prev => [...prev.filter(i => i.teamId !== team.id), ...teamItems]);
            }, (error) => handleSnapshotError(error, itemsRef));
            allUnsubs.push(unsubItems);
        });

        setLoading(false);
        return () => allUnsubs.forEach(unsub => unsub());
      } else {
         await setupInitialData();
         setLoading(false);
      }
    }, (error) => {
      handleSnapshotError(error, teamsRef);
      setLoading(false);
    });

    return () => {
        if (unsubTeams) unsubTeams();
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
