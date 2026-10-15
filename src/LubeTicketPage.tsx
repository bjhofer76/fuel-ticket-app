import { useState, type FormEvent, type MouseEvent } from "react";
import { supabase } from "./lib/supabase";

type Product = {
	id?: string | number;
	product_code?: string | null;
	product_name?: string | null;
	current_price?: number | string | null;
	sales_tax_code?: string | number | null;
	quickbooks_tax_code?: string | null;
};

type Customer = {
	id?: string | number;
	business_name?: string | null;
};

type TaxCode = {
	sales_tax_code?: string | number | null;
	description?: string | null;
	tax_rate?: number | string | null;
	is_taxable?: boolean | null;
};

type LubeLine = {
	id: string;
	productIndex: string;
	quantity: string;
	sellPrice: string;
	salesTaxCode: string;
};

type Props = {
	products: Product[];
	customers: Customer[];
	driverNames: string[];
	taxCodes: TaxCode[];
	referencesLoading: boolean;
	referenceError: string;
	nextTicketNumber: number | null;
	ticketNumberLoading: boolean;
	ticketNumberError: string;
	getNextTicketNumber: () => Promise<number>;
	onTicketNumberUpdated: (ticketNumber: number) => void;
	onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
};

const localDateValue = () => {
	const date = new Date();
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const createLine = (): LubeLine => ({
	id: crypto.randomUUID(),
	productIndex: "",
	quantity: "",
	sellPrice: "",
	salesTaxCode: "",
});

const formatMoney = (amount: number) =>
	new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

export function LubeTicketPage({
	products,
	customers,
	driverNames,
	taxCodes,
	referencesLoading,
	referenceError,
	nextTicketNumber,
	ticketNumberLoading,
	ticketNumberError,
	getNextTicketNumber,
	onTicketNumberUpdated,
	onNavigate,
}: Props) {
	const [customerId, setCustomerId] = useState("");
	const [driverName, setDriverName] = useState("");
	const [deliveryDate, setDeliveryDate] = useState(localDateValue);
	const [location, setLocation] = useState("South Dakota");
	const [lines, setLines] = useState<LubeLine[]>([createLine()]);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");

	const preparedLines = lines.map((line) => {
		const product = line.productIndex === "" ? null : products[Number(line.productIndex)] ?? null;
		const quantity = Number(line.quantity);
		const sellPrice = Number(line.sellPrice);
		const taxCode = taxCodes.find((candidate) =>
			String(candidate.sales_tax_code ?? "").trim() === line.salesTaxCode,
		);
		const rate = taxCode?.tax_rate == null ? 0 : Number(taxCode.tax_rate);
		const extendedAmount = quantity * sellPrice;
		const taxableAmount = taxCode?.is_taxable === true ? extendedAmount : 0;
		const salesTaxAmount = taxCode?.is_taxable === true && Number.isFinite(rate)
			? Math.round((extendedAmount * rate + Number.EPSILON) * 100) / 100
			: 0;
		const valid = Boolean(product) &&
			line.quantity.trim() !== "" && Number.isFinite(quantity) && quantity > 0 &&
			line.sellPrice.trim() !== "" && Number.isFinite(sellPrice) && sellPrice >= 0 &&
			Boolean(taxCode) && Number.isFinite(rate) && rate >= 0 && rate <= 1;
		return { ...line, product, quantity, sellPrice, extendedAmount, taxableAmount, salesTaxAmount, valid };
	});
	const subtotal = preparedLines.reduce((total, line) =>
		total + (Number.isFinite(line.extendedAmount) ? line.extendedAmount : 0), 0);
	const taxableSubtotal = preparedLines.reduce((total, line) => total + line.taxableAmount, 0);
	const salesTaxTotal = preparedLines.reduce((total, line) => total + line.salesTaxAmount, 0);
	const netAmountDue = subtotal + salesTaxTotal;
	const hasValidLines = preparedLines.length > 0 && preparedLines.every((line) => line.valid);

	const updateLine = (lineId: string, update: Partial<LubeLine>) => {
		setLines((current) => current.map((line) =>
			line.id === lineId ? { ...line, ...update } : line,
		));
		setError("");
		setMessage("");
	};

	const createTicket = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const customer = customers.find((candidate) => String(candidate.id ?? "") === customerId);
		if (!customer || !driverName || !deliveryDate || !location.trim() || !hasValidLines) return;

		setSaving(true);
		setError("");
		setMessage("");
		try {
			const ticketNumber = await getNextTicketNumber();
			onTicketNumberUpdated(ticketNumber);
			const firstLine = preparedLines[0];
			const { data: ticket, error: insertError } = await supabase
				.from("delivery_tickets")
				.insert({
					ticket_number: ticketNumber,
					ticket_type: "LUBE",
					customer_id: customer.id,
					driver_name: driverName,
					delivery_date: deliveryDate,
					location: location.trim(),
					product_code: firstLine.product?.product_code,
					product_name: firstLine.product?.product_name || firstLine.product?.product_code,
					sales_tax_code: firstLine.salesTaxCode,
					quantity: preparedLines.reduce((total, line) => total + line.quantity, 0),
					sell_price: firstLine.sellPrice,
					extended_amount: subtotal,
					taxable_subtotal: taxableSubtotal,
					sales_tax_total: salesTaxTotal,
					invoice_subtotal: subtotal,
					prompt_pay_discount: 0,
					discounted_total: subtotal,
					net_amount_due: netAmountDue,
				})
				.select("id")
				.single();
			if (insertError) throw new Error(insertError.message);
			if (ticket?.id === null || ticket?.id === undefined) {
				throw new Error("The ticket was created, but its ID could not be retrieved for saving product lines.");
			}

			const { error: linesError } = await supabase.from("delivery_ticket_items").insert(
				preparedLines.map((line) => ({
					ticket_id: ticket.id,
					product_code: line.product?.product_code,
					product_name: line.product?.product_name || line.product?.product_code,
					quantity: line.quantity,
					sell_price: line.sellPrice,
					extended_amount: line.extendedAmount,
					taxable_amount: line.taxableAmount,
					sales_tax_amount: line.salesTaxAmount,
					sales_tax_code: line.salesTaxCode,
				})),
			);
			if (linesError) {
				throw new Error(`Ticket ${ticketNumber} was created, but its product lines could not be saved: ${linesError.message}`);
			}

			setMessage(`LUBE ticket ${ticketNumber} saved.`);
			setLines([createLine()]);
			setCustomerId("");
			setDriverName("");
			setDeliveryDate(localDateValue());
			setLocation("South Dakota");
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : "Unable to save LUBE ticket.");
		} finally {
			setSaving(false);
			try {
				onTicketNumberUpdated(await getNextTicketNumber());
			} catch (numberError) {
				setError((current) => [
					current,
					numberError instanceof Error ? numberError.message : "Unable to refresh the next ticket number.",
				].filter(Boolean).join(" "));
			}
		}
	};

	return (
		<>
			<div className="page-heading">
				<div>
					<p className="eyebrow">BULK OIL &amp; LUBRICANTS</p>
					<h1>Create LUBE Ticket</h1>
					<p className="heading-description">Record lubricant product sales using the shared customer, driver, and ticket history.</p>
				</div>
				<a className="secondary-page-link" href="/" onClick={onNavigate}>Dashboard</a>
			</div>
			{referenceError && <p className="reference-error" role="alert">{referenceError}</p>}
			<form className="ticket-form lube-ticket-form" onSubmit={(event) => void createTicket(event)}>
				<section className="ticket-form-card ticket-information-card">
					<div className="ticket-form-card-heading">
						<h3>Ticket Information</h3>
						<p><span className="ticket-type-badge lube">LUBE</span></p>
					</div>
					<div className="ticket-information-grid">
						<label className="form-field">
							<span>Ticket number</span>
							<input readOnly value={ticketNumberLoading ? "Loading…" : nextTicketNumber ?? ""} />
						</label>
						<label className="form-field">
							<span>Business name</span>
							<select required value={customerId} onChange={(event) => setCustomerId(event.target.value)} disabled={referencesLoading}>
								<option value="">{referencesLoading ? "Loading customers…" : "Select a customer"}</option>
								{customers.map((customer, index) => (
									<option key={`${customer.id ?? index}-${index}`} value={customer.id ?? ""}>
										{customer.business_name || "Unnamed customer"}
									</option>
								))}
							</select>
						</label>
						<label className="form-field">
							<span>Driver name</span>
							<select required value={driverName} onChange={(event) => setDriverName(event.target.value)} disabled={referencesLoading}>
								<option value="">{referencesLoading ? "Loading drivers…" : "Select a driver"}</option>
								{driverNames.map((name) => <option value={name} key={name}>{name}</option>)}
							</select>
						</label>
						<label className="form-field">
							<span>Delivery date</span>
							<input required type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} />
						</label>
						<label className="form-field">
							<span>Location</span>
							<select required value={location} onChange={(event) => setLocation(event.target.value)}>
								<option value="South Dakota">South Dakota</option>
								<option value="Nebraska">Nebraska</option>
								<option value="Other">Other</option>
							</select>
						</label>
					</div>
				</section>

				<section className="ticket-form-card">
					<div className="product-lines-heading">
						<h3>Lubricant Products</h3>
						<button className="add-product-button" type="button" onClick={() => setLines((current) => [...current, createLine()])}>
							<span aria-hidden="true">+</span> Add Product
						</button>
					</div>
					{products.length === 0 && !referencesLoading && <p className="reference-error">No LUBE products are available.</p>}
					{preparedLines.map((line, index) => (
						<div className="lube-line-row" key={line.id}>
							<label className="form-field">
								<span>Product {index + 1}</span>
								<select
									required
									value={line.productIndex}
									onChange={(event) => {
										const productIndex = event.target.value;
										const product = productIndex === "" ? null : products[Number(productIndex)] ?? null;
										updateLine(line.id, {
											productIndex,
											sellPrice: product?.current_price == null ? "" : String(product.current_price),
											salesTaxCode: product?.sales_tax_code == null ? "" : String(product.sales_tax_code).trim(),
										});
									}}
									disabled={referencesLoading || products.length === 0}
								>
									<option value="">{referencesLoading ? "Loading products…" : "Select a lubricant"}</option>
									{products.map((product, productIndex) => (
										<option value={productIndex} key={`${product.id ?? product.product_code ?? productIndex}-${productIndex}`}>
											{product.product_name || product.product_code || `Product ${productIndex + 1}`}
											{product.quickbooks_tax_code ? ` · QB ${product.quickbooks_tax_code}` : ""}
										</option>
									))}
								</select>
							</label>
							<label className="form-field">
								<span>Quantity</span>
								<input required type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: event.target.value })} />
							</label>
							<label className="form-field">
								<span>Price per unit</span>
								<input required type="number" min="0" step="0.01" value={line.sellPrice} onChange={(event) => updateLine(line.id, { sellPrice: event.target.value })} />
							</label>
							<label className="form-field">
								<span>Sales tax treatment</span>
								<select required value={line.salesTaxCode} onChange={(event) => updateLine(line.id, { salesTaxCode: event.target.value })}>
									<option value="">Choose configured tax code</option>
									{taxCodes.map((taxCode, taxIndex) => {
										const code = String(taxCode.sales_tax_code ?? "").trim();
										return <option key={`${code}-${taxIndex}`} value={code}>{code}{taxCode.description ? ` — ${taxCode.description}` : ""}</option>;
									})}
								</select>
							</label>
							<strong className="lube-line-amount">{formatMoney(Number.isFinite(line.extendedAmount) ? line.extendedAmount : 0)}</strong>
							{lines.length > 1 && (
								<button className="remove-product-button" type="button" onClick={() => setLines((current) => current.filter((draft) => draft.id !== line.id))}>
									Remove
								</button>
							)}
						</div>
					))}
				</section>

				<section className="ticket-form-card pricing-totals-card">
					<div className="ticket-form-card-heading">
						<h3>Pricing &amp; Totals</h3>
						<p>No fuel taxes or prompt-pay discount are applied to LUBE tickets.</p>
					</div>
					<div className="product-lines-total lube-totals">
						<span>Subtotal<strong>{formatMoney(subtotal)}</strong></span>
						<span>Taxable subtotal<strong>{formatMoney(taxableSubtotal)}</strong></span>
						<span>Sales tax<strong>{formatMoney(salesTaxTotal)}</strong></span>
						<span>Net due<strong>{formatMoney(netAmountDue)}</strong></span>
					</div>
				</section>
				<div className="ticket-form-footer">
					<div className="form-feedback" aria-live="polite">
						{(error || ticketNumberError) && <span className="form-error" role="alert">{[error, ticketNumberError].filter(Boolean).join(" ")}</span>}
						{message && <span className="form-success">{message} <a href="/ticket-history" onClick={onNavigate}>View Ticket History</a></span>}
						{!referencesLoading && customers.length === 0 && <span className="form-error">No customers are available to select.</span>}
						{!referencesLoading && driverNames.length === 0 && <span className="form-error">No drivers are available to select.</span>}
						{!referencesLoading && taxCodes.length === 0 && <span className="form-error">Configure sales tax codes before creating LUBE tickets.</span>}
					</div>
					<button className="submit-ticket-button" type="submit" disabled={
						saving || ticketNumberLoading || nextTicketNumber === null || Boolean(ticketNumberError) ||
						referencesLoading || !hasValidLines || !customerId || !driverName || !deliveryDate || !location.trim()
					}>
						{saving ? "Saving…" : "Save LUBE Ticket"}
					</button>
				</div>
			</form>
		</>
	);
}
