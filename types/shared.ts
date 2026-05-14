export interface User {
  id: string;
  email: string | null;
  household_id: string;
  created_at: number;
}

export interface Household {
  id: string;
  name: string;
  created_at: number;
}

export interface PantryItem {
  id: string;
  household_id: string;
  name: string;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  in_stock: 0 | 1;
  updated_at: number;
}

export interface MealIngredient {
  name: string;
  quantity?: number;
  unit?: string;
}

// Shared between Worker and frontend — ingredients/steps are already parsed.
export interface MealEntryData {
  date: string;
  name: string;
  ingredients?: MealIngredient[];
  steps?: string[];
}

export interface GroceryItem {
  name: string;
  quantity?: number;
  unit?: string;
  category: string | null;
}
