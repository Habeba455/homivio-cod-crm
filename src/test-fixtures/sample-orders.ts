import type { SourceStatus } from "../modules/orders/domain/status";

/**
 * Test fixture generated from sample_orders.json (50 orders), in source order.
 * Names and addresses are omitted. Phone numbers are kept because matching depends on them.
 * Test data only: never used by application code.
 */
export type SampleOrder = {
  id: string;
  sourceStatus: SourceStatus;
  createdAt: string;
  phone: string;
  city: string;
};

export const SAMPLE_ORDERS: readonly SampleOrder[] = [
  { id: "BRX-1001", sourceStatus: "delivered", createdAt: "2026-09-09T10:56:00+01:00", phone: "+212600036026", city: "Rabat" },
  { id: "BRX-1002", sourceStatus: "refused", createdAt: "2026-09-09T15:08:00+01:00", phone: "+212600031781", city: "Sale" },
  { id: "BRX-1003", sourceStatus: "refused", createdAt: "2026-09-15T22:34:00+01:00", phone: "+212600001326", city: "El Jadida" },
  { id: "BRX-1004", sourceStatus: "delivered", createdAt: "2026-09-16T13:57:00+01:00", phone: "+212600033890", city: "Casablanca" },
  { id: "BRX-1005", sourceStatus: "cancelled", createdAt: "2026-09-18T12:32:00+01:00", phone: "+212600038849", city: "Tanger" },
  { id: "BRX-1006", sourceStatus: "cancelled", createdAt: "2026-09-20T10:26:00+01:00", phone: "+212600018495", city: "Sale" },
  { id: "BRX-1007", sourceStatus: "new", createdAt: "2026-10-20T13:36:00+01:00", phone: "+212600082278", city: "Sale" },
  { id: "BRX-1008", sourceStatus: "new", createdAt: "2026-10-20T19:12:00+01:00", phone: "+212600018451", city: "Meknes" },
  { id: "BRX-1009", sourceStatus: "new", createdAt: "2026-10-20T20:34:00+01:00", phone: "+212600001326", city: "Casablanca" },
  { id: "BRX-1010", sourceStatus: "new", createdAt: "2026-10-21T11:00:00+01:00", phone: "+212600046578", city: "Meknes" },
  { id: "BRX-1011", sourceStatus: "new", createdAt: "2026-10-21T16:44:00+01:00", phone: "+212600053419", city: "Tanger" },
  { id: "BRX-1012", sourceStatus: "new", createdAt: "2026-10-21T21:13:00+01:00", phone: "+212600047468", city: "Sale" },
  { id: "BRX-1013", sourceStatus: "new", createdAt: "2026-10-22T09:16:00+01:00", phone: "+212600026542", city: "Oujda" },
  { id: "BRX-1014", sourceStatus: "new", createdAt: "2026-10-22T13:52:00+01:00", phone: "+212600033150", city: "Marrakech" },
  { id: "BRX-1015", sourceStatus: "new", createdAt: "2026-10-22T18:34:00+01:00", phone: "+212600081489", city: "Casablanca" },
  { id: "BRX-1016", sourceStatus: "new", createdAt: "2026-10-22T18:36:00+01:00", phone: "+212600005009", city: "Tanger" },
  { id: "BRX-1017", sourceStatus: "new", createdAt: "2026-10-22T19:55:00+01:00", phone: "+212600016475", city: "Oujda" },
  { id: "BRX-1018", sourceStatus: "new", createdAt: "2026-10-22T21:36:00+01:00", phone: "+212600018495", city: "Tanger" },
  { id: "BRX-1019", sourceStatus: "new", createdAt: "2026-10-23T10:46:00+01:00", phone: "+212600069784", city: "Fes" },
  { id: "BRX-1020", sourceStatus: "new", createdAt: "2026-10-23T13:27:00+01:00", phone: "+212600036026", city: "Oujda" },
  { id: "BRX-1021", sourceStatus: "new", createdAt: "2026-10-23T16:44:00+01:00", phone: "+212600047382", city: "Tanger" },
  { id: "BRX-1022", sourceStatus: "new", createdAt: "2026-10-23T22:01:00+01:00", phone: "+212600094078", city: "Tetouan" },
  { id: "BRX-1023", sourceStatus: "new", createdAt: "2026-10-24T09:05:00+01:00", phone: "+212600053287", city: "Fes" },
  { id: "BRX-1024", sourceStatus: "new", createdAt: "2026-10-24T09:45:00+01:00", phone: "+212600033890", city: "Kenitra" },
  { id: "BRX-1025", sourceStatus: "new", createdAt: "2026-10-24T12:51:00+01:00", phone: "+212600039301", city: "Fes" },
  { id: "BRX-1026", sourceStatus: "new", createdAt: "2026-10-24T14:17:00+01:00", phone: "+212600064139", city: "Tetouan" },
  { id: "BRX-1027", sourceStatus: "new", createdAt: "2026-10-24T15:20:00+01:00", phone: "+212600086379", city: "Fes" },
  { id: "BRX-1028", sourceStatus: "new", createdAt: "2026-10-24T19:26:00+01:00", phone: "+212600082081", city: "Agadir" },
  { id: "BRX-1029", sourceStatus: "new", createdAt: "2026-10-24T21:49:00+01:00", phone: "+212600037631", city: "Kenitra" },
  { id: "BRX-1030", sourceStatus: "new", createdAt: "2026-10-25T15:38:00+01:00", phone: "+212600010341", city: "Kenitra" },
  { id: "BRX-1031", sourceStatus: "new", createdAt: "2026-10-25T17:05:00+01:00", phone: "+212600031051", city: "Marrakech" },
  { id: "BRX-1032", sourceStatus: "new", createdAt: "2026-10-26T15:21:00+01:00", phone: "+212600037672", city: "Kenitra" },
  { id: "BRX-1033", sourceStatus: "new", createdAt: "2026-10-26T16:00:00+01:00", phone: "+212600089638", city: "Agadir" },
  { id: "BRX-1034", sourceStatus: "new", createdAt: "2026-10-26T16:58:00+01:00", phone: "+212600004332", city: "Oujda" },
  { id: "BRX-1035", sourceStatus: "new", createdAt: "2026-10-26T19:36:00+01:00", phone: "+212600031781", city: "Fes" },
  { id: "BRX-1036", sourceStatus: "new", createdAt: "2026-10-26T19:52:00+01:00", phone: "+212600023430", city: "Oujda" },
  { id: "BRX-1037", sourceStatus: "new", createdAt: "2026-10-26T22:02:00+01:00", phone: "+212600038849", city: "Oujda" },
  { id: "BRX-1038", sourceStatus: "new", createdAt: "2026-10-26T22:31:00+01:00", phone: "+212600056670", city: "Rabat" },
  { id: "BRX-1039", sourceStatus: "new", createdAt: "2026-10-27T10:43:00+01:00", phone: "+212600087262", city: "Fes" },
  { id: "BRX-1040", sourceStatus: "new", createdAt: "2026-10-27T16:43:00+01:00", phone: "+212600011615", city: "Fes" },
  { id: "BRX-1041", sourceStatus: "new", createdAt: "2026-10-27T18:39:00+01:00", phone: "+212600019136", city: "Sale" },
  { id: "BRX-1042", sourceStatus: "new", createdAt: "2026-10-27T19:45:00+01:00", phone: "+212600006513", city: "Oujda" },
  { id: "BRX-1043", sourceStatus: "new", createdAt: "2026-10-28T14:01:00+01:00", phone: "+212600039117", city: "Rabat" },
  { id: "BRX-1044", sourceStatus: "new", createdAt: "2026-10-28T16:03:00+01:00", phone: "+212600027048", city: "Kenitra" },
  { id: "BRX-1045", sourceStatus: "new", createdAt: "2026-10-28T21:30:00+01:00", phone: "+212600081960", city: "Oujda" },
  { id: "BRX-1046", sourceStatus: "new", createdAt: "2026-10-28T21:34:00+01:00", phone: "+212600052880", city: "Sale" },
  { id: "BRX-1047", sourceStatus: "new", createdAt: "2026-10-29T14:30:00+01:00", phone: "+212600012269", city: "Kenitra" },
  { id: "BRX-1048", sourceStatus: "new", createdAt: "2026-10-29T21:07:00+01:00", phone: "+212600083276", city: "Tetouan" },
  { id: "BRX-1049", sourceStatus: "new", createdAt: "2026-10-29T21:33:00+01:00", phone: "+212600070154", city: "Tetouan" },
  { id: "BRX-1050", sourceStatus: "new", createdAt: "2026-10-29T22:46:00+01:00", phone: "+212600035030", city: "Kenitra" },
];
