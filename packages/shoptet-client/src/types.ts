// `Shop` žije v platform-neutrální vrstvě (@puls/platform-core/src/shop.ts) —
// shop není shoptet-specifický (nese `platform` discriminator). Re-exportujeme
// ho odsud jen pro interní importy v rámci tohoto balíčku; nový kód má brát
// `Shop` přímo z `@puls/platform-core`.
export type { Shop } from '@puls/platform-core';

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type?: string;
};

export type EshopInfoResponse = {
  data: {
    project: { id: number; url: string };
    user: { email: string; name?: string | null };
  };
};

export type Order = {
  code: string;
  status: string;
  totalPrice?: string | number;
};

export type OrderListResponse = {
  data: Order[];
};

export type OrderItem = {
  name: string;
  amount?: number;
  unitPrice?: string | number;
};

export type OrderDetail = Order & {
  creationTime?: string;
  currency?: string;
  customer?: { email?: string; name?: string };
  items?: OrderItem[];
};

export type OrderDetailResponse = {
  data: OrderDetail;
};

export type OrderChange = {
  code: string;
  changeType: string;
  changedAt: string;
};

export type OrderChangesResponse = {
  data: {
    cursor?: string;
    changes: OrderChange[];
  };
};

export type Product = {
  guid: string;
  name: string;
  code?: string;
  price?: string | number;
  currency?: string;
  visible?: boolean;
};

export type ProductListResponse = {
  data: Product[];
};

export type ProductDetail = Product & {
  description?: string;
  categories?: string[];
};

export type ProductDetailResponse = {
  data: ProductDetail;
};

export type Customer = {
  guid: string;
  email: string;
  name?: string;
};

export type CustomerListResponse = {
  data: Customer[];
};

export type CustomerDetail = Customer & {
  phone?: string;
  ordersCount?: number;
};

export type CustomerDetailResponse = {
  data: CustomerDetail;
};

export type Stock = {
  id: string;
  name: string;
  default?: boolean;
};

export type StockListResponse = {
  data: Stock[];
};

export type Category = {
  guid: string;
  name: string;
  parentGuid?: string | null;
  visible?: boolean;
};

export type CategoryListResponse = {
  data: Category[];
};

export type EshopMeta = {
  id: number;
  name: string;
  url: string;
  currency?: string;
  language?: string;
  vatPayer?: boolean;
};

export type EshopMetaResponse = {
  data: EshopMeta;
};
