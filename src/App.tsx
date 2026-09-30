import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

type Customer = {
id: number;
business_name: string | null;
};
 
type Product = {
id: number;
product_code: string | null;
product_name: string | null;
excise_tax_code: string | null;
sales_tax_code: string | null;
};
  
function App() {
const [customers, setCustomers] = useState<Customer[]>([]);
const [products, setProducts] = useState<Product[]>([]);
 
const [ticketNumber, setTicketNumber] = useState(
`FT-${Date.now()}`
);
const [customerId, setCustomerId] = useState("");
const [productId, setProductId] = useState("");
const [quantity, setQuantity] = useState("");
const [pricePerGallon, setPricePerGallon] = useState("");
const totalAmount =
Number(quantity || 0) * Number(pricePerGallon || 0);
const [location, setLocation] = useState("");
const [message, setMessage] = useState("");
 
useEffect(() => {
loadData();
}, []);
 
async function loadData() {
const { data: customerData } = await supabase
.from("customers")
.select("*")
.eq("active", true);
 
const { data: productData } = await supabase
.from("products")
.select("*")
.eq("active", true);
 
setCustomers(customerData || []);
setProducts(productData || []);
}
 
async function saveTicket() {
  if (!customerId || !productId || !location || !quantity) {
setMessage("Please complete all fields");
return;
}
const selectedProduct = products.find(
(p) => p.id === Number(productId)
);
 
const { error } = await supabase
.from("delivery_tickets")
.insert([
{
ticket_number: ticketNumber,
customer_id: Number(customerId),
quantity: Number(quantity),
location: location,
product_code: selectedProduct?.product_code,
product_name: selectedProduct?.product_name,
excise_tax_code: selectedProduct?.excise_tax_code,
sales_tax_code: selectedProduct?.sales_tax_code
}
]);
 
if (error) {
setMessage(`Error: ${error.message}`);
} else {
setMessage("Ticket Saved!");
setTicketNumber(`FT-${Date.now()}`);
setCustomerId("");
setProductId("");
setQuantity("");
setLocation("");
}
}
 
return (
<div style={{ padding: "20px" }}>
<h1>Fuel Delivery Ticket App</h1>
 
<div>
<label>Ticket Number</label>
<br />
<input
value={ticketNumber}
onChange={(e) => setTicketNumber(e.target.value)}
/>
</div>
 
<br />
 
<div>
<label>Customer</label>
<br />
<select
value={customerId}
onChange={(e) => setCustomerId(e.target.value)}
>
<option value="">Select Customer</option>
 
{customers.map((customer) => (
<option key={customer.id} value={customer.id}>
{customer.business_name}
</option>
))}
</select>
</div>
 
<br />
 
<div>
<label>Product</label>
<br />
<select
value={productId}
onChange={(e) => setProductId(e.target.value)}
>
<option value="">Select Product</option>
 
{products.map((product) => (
<option key={product.id} value={product.id}>
{product.product_name}
</option>
))}
</select>
</div>
 
<br />
 
<div>
<label>Location</label>
<br />
<input
value={location}
onChange={(e) => setLocation(e.target.value)}
/>
</div>
 
<br />
 
<div>
<label>Quantity</label>
<br />
<input
type="number"
value={quantity}
onChange={(e) => setQuantity(e.target.value)}
/>
</div>
 
<br />
 
<button onClick={saveTicket}>
Save Ticket
</button>
 
<p>{message}</p>
</div>
);
}
 
export default App;
