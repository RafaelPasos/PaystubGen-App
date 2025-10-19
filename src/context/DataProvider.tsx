'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, DocumentData, query, writeBatch, getDocs, where } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { Employee, ProductionItem, ProductionEntry, Team } from '@/lib/types';
import { useToast } from "@/hooks/use-toast"
import { addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { subDays, startOfWeek, formatISO } from 'date-fns';

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

const defaultItems = {
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
    await batch.commit();
  };


  useEffect(() => {
    if (!firestore) return;
    setLoading(true);

    const setupTeamData = async (team: Team) => {
        const itemsRef = collection(firestore, `teams/${team.id}/productionItems`);
        const itemsSnap = await getDocs(itemsRef);
        if (itemsSnap.empty) {
            const batch = writeBatch(firestore);
            const teamDefaultItems = defaultItems[team.name as keyof typeof defaultItems] || [];
            teamDefaultItems.forEach(item => {
                const newItemRef = doc(itemsRef);
                batch.set(newItemRef, { ...item, teamId: team.id });
            });
            await batch.commit();
        }

        onSnapshot(query(collection(firestore, `teams/${team.id}/employees`)), (snapshot) => {
            const employeeData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
            setEmployees(prev => [...prev.filter(e => e.teamId !== team.id), ...employeeData]);

            snapshot.docs.forEach(empDoc => {
                onSnapshot(collection(firestore, `teams/${team.id}/employees/${empDoc.id}/dailyProduction`), productionSnapshot => {
                    const productionData = productionSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionEntry));
                    setProduction(prev => [...prev.filter(p=> p.employeeId !== empDoc.id), ...productionData]);
                });
            });
        });

        onSnapshot(itemsRef, (snapshot) => {
            const itemsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionItem));
            setItems(prev => [...prev.filter(i => i.teamId !== team.id), ...itemsData]);
        });
    };

    const unsubTeams = onSnapshot(collection(firestore, 'teams'), async (snapshot) => {
      const teamsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team));
      setTeams(teamsData);
      
      if (teamsData.length > 0) {
        await Promise.all(teamsData.map(team => setupTeamData(team)));
        setLoading(false);
      } else {
        setLoading(false);
      }
    }, (error) => {
      console.error("Error fetching teams:", error);
      toast({ title: "Error", description: "Could not fetch teams.", variant: "destructive" });
      setLoading(false);
    });

    return () => unsubTeams();
  }, [firestore, toast]);
  

  const addEmployee = async (employee: Omit<Employee, 'id'>) => {
    if (!firestore) return;
    const newDocRef = await addDoc(collection(firestore, `teams/${employee.teamId}/employees`), employee);
    const teamItems = items.filter(item => item.teamId === employee.teamId);
    await createInitialProductionEntries(newDocRef.id, employee.teamId, teamItems);
  };

  const updateEmployee = async (id: string, teamId: string, employee: Partial<Employee>) => {
    if (!firestore) return;
    await updateDocumentNonBlocking(doc(firestore, `teams/${teamId}/employees`, id), employee as DocumentData);
  };

  const deleteEmployee = async (id: string, teamId: string) => {
    if (!firestore) return;
    await deleteDocumentNonBlocking(doc(firestore, `teams/${teamId}/employees`, id));
  };

  const addItem = async (item: Omit<ProductionItem, 'id'>) => {
    if (!firestore) return;
    await addDocumentNonBlocking(collection(firestore, `teams/${item.teamId}/productionItems`), item as DocumentData);
  };

  const updateItem = async (id: string, teamId: string, item: Partial<ProductionItem>) => {
    if (!firestore) return;
    await updateDocumentNonBlocking(doc(firestore, `teams/${teamId}/productionItems`, id), item as DocumentData);
  };

  const deleteItem = async (id: string, teamId: string) => {
    if (!firestore) return;
    await deleteDocumentNonBlocking(doc(firestore, `teams/${teamId}/productionItems`, id));
  };

  const addProductionEntry = async (entry: Omit<ProductionEntry, 'id'>) => {
    if (!firestore) return;
    // We need to find the teamId from the employee
    const employee = employees.find(e => e.id === entry.employeeId);
    if (!employee) return;
    await addDocumentNonBlocking(collection(firestore, `teams/${employee.teamId}/employees/${entry.employeeId}/dailyProduction`), entry as DocumentData);
  };

  const updateProductionEntry = async (id: string, teamId: string, employeeId: string, entry: Partial<ProductionEntry>) => {
     if (!firestore) return;
     await updateDocumentNonBlocking(doc(firestore, `teams/${teamId}/employees/${employeeId}/dailyProduction`, id), entry as DocumentData);
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
