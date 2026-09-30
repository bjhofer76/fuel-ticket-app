import { useState } from "react";
import { supabase } from "./lib/supabase";
 
function App() {
const [message, setMessage] = useState("");
 
const saveTicket = async () => {
const { error } = await supabase
.from("delivery_tickets")
.insert([
{
ticket_number: "TEST-001",
quantity: 100
}
]);
 
if (error) {
setMessage(`Error: ${error.message}`);
} else {
setMessage("Ticket Saved!");
}
};
 
return (
<div style={{ padding: "20px" }}>
<h1>Fuel Delivery Ticket App</h1>
 
<button onClick={saveTicket}>
Save Test Ticket
</button>
 
<p>{message}</p>
</div>
);
}
 
export default App;