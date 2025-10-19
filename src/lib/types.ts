export type Employee = {
  id: string;
  name: string;
  team: 'Team A' | 'Team B';
};

export type ProductionItem = {
  id: string;
  name: string;
  rate: number;
};

export type ProductionEntry = {
  id:string;
  employeeId: string;
  itemId: string;
  date: string; // ISO string for date
  quantity: number;
};
