const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Customers
export const fetchCustomers = () => request("/api/customers");
export const createCustomer = (data) => request("/api/customers", { method: "POST", body: JSON.stringify(data) });
export const updateCustomer = (id, data) => request(`/api/customers/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteCustomerApi = (id) => request(`/api/customers/${id}`, { method: "DELETE" });

// Invoices
export const fetchInvoices = () => request("/api/invoices");
export const createInvoice = (data) => request("/api/invoices", { method: "POST", body: JSON.stringify(data) });
export const updateInvoice = (id, data) => request(`/api/invoices/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteInvoiceApi = (id) => request(`/api/invoices/${id}`, { method: "DELETE" });
export const setInvoiceStatusApi = (id, status) =>
  request(`/api/invoices/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
