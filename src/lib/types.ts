export type Team = {
    id: string;
    name: string;
};

export type Employee = {
  id: string;
  name: string;
  teamId: string;
};

export type ProductionItem = {
  id: string;
  name: string;
  payRate: number;
  teamId: string;
};

export type ProductionEntry = {
  id:string;
  employeeId: string;
  productionItemId: string;
  date: string; // ISO string for date
  quantity: number;
};
