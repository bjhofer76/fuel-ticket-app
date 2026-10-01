import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { companyCityLine, companyInfo } from "./lib/company-settings";
import "./App.css";

type Ticket = {
	ticket_number?: string | number | null;
	customer_id?: string | number | null;
	business_name?: string | null;
	location?: string | null;
	product_code?: string | number | null;
	product_name?: string | null;
	quantity?: number | string | null;
	sell_price?: number | string | null;
	extended_amount?: number | string | null;
	excise_tax_code?: string | number | null;
	sales_tax_code?: string | number | null;
	created_at?: string | null;
	[key: string]: unknown;
};

type Product = {
	id?: string | number;
	product_code?: string | null;
	product_name?: string | null;
	name?: string | null;
	code?: string | null;
	sku?: string | null;
	sell_price?: number | string | null;
	[key: string]: unknown;
};

type Customer = {
	id?: string | number;
	customer_id?: string | number;
	business_name?: string | null;
	[key: string]: unknown;
};

type DeliveryDateFilter = "all" | "today" | "7days" | "30days" | "year";

const generateTicketNumber = () =>
	`TKT-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;

function App() {
	const [path, setPath] = useState(window.location.pathname);
	const [tickets, setTickets] = useState<Ticket[]>([]);
	const [products, setProducts] = useState<Product[]>([]);
	const [customers, setCustomers] = useState<Customer[]>([]);
	const [historyCustomers, setHistoryCustomers] = useState<Customer[]>([]);
	const [customerHistoryTickets, setCustomerHistoryTickets] = useState<Ticket[]>([]);
	const [search, setSearch] = useState("");
	const [customerSearch, setCustomerSearch] = useState("");
	const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
	const [selectedHistoryCustomerId, setSelectedHistoryCustomerId] = useState("");
	const [deliveryDateFilter, setDeliveryDateFilter] = useState<DeliveryDateFilter>("all");
	const [historyCustomersLoading, setHistoryCustomersLoading] = useState(false);
	const [customerTicketsLoading, setCustomerTicketsLoading] = useState(false);
	const [historyCustomersError, setHistoryCustomersError] = useState("");
	const [customerTicketsError, setCustomerTicketsError] = useState("");
	const [selectedProductIndex, setSelectedProductIndex] = useState("");
	const [selectedCustomerIndex, setSelectedCustomerIndex] = useState("");
	const [location, setLocation] = useState("");
	const [quantity, setQuantity] = useState("");
	const [sellPrice, setSellPrice] = useState("");
	const [referencesLoading, setReferencesLoading] = useState(false);
	const [savingTicket, setSavingTicket] = useState(false);
	const [referenceError, setReferenceError] = useState("");
	const [formError, setFormError] = useState("");
	const [formMessage, setFormMessage] = useState("");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const isHistoryPage = path === "/ticket-history";
	const isCustomerHistoryPage = path === "/customer-history";
	const isCreateTicketPage = path === "/create-ticket";

	useEffect(() => {
		const updatePath = () => setPath(window.location.pathname);
		window.addEventListener("popstate", updatePath);
		return () => window.removeEventListener("popstate", updatePath);
	}, []);

	useEffect(() => {
		if (!isHistoryPage) return;

		const loadTickets = async () => {
			setLoading(true);
			setError("");
			const [ticketResult, customerResult] = await Promise.all([
				supabase
					.from("delivery_tickets")
					.select("*")
					.order("created_at", { ascending: false }),
				supabase.from("customers").select("*"),
			]);

			if (ticketResult.error) {
				setError(ticketResult.error.message);
			} else {
				const customerById = new Map<string, Customer>();
				for (const customer of (customerResult.data ?? []) as Customer[]) {
					const customerId = customer.id ?? customer.customer_id;
					if (customerId !== null && customerId !== undefined) {
						customerById.set(String(customerId), customer);
					}
				}

				const ticketRows = (ticketResult.data ?? []) as Ticket[];
				setTickets(ticketRows.map((ticket) => {
					const customer = ticket.customer_id == null
						? undefined
						: customerById.get(String(ticket.customer_id));
					const businessName = ticket.business_name ?? customer?.business_name ?? null;
					return {
						...ticket,
						business_name: businessName,
					};
				}));
			}
			setLoading(false);
		};

		void loadTickets();
	}, [isHistoryPage]);

	useEffect(() => {
		if (!isCustomerHistoryPage) return;

		const loadHistoryCustomers = async () => {
			setHistoryCustomersLoading(true);
			setHistoryCustomersError("");
			const { data, error: queryError } = await supabase
				.from("customers")
				.select("id, business_name")
				.order("business_name", { ascending: true });

			if (queryError) {
				setHistoryCustomersError(queryError.message);
				setHistoryCustomers([]);
			} else {
				setHistoryCustomers((data ?? []) as Customer[]);
			}
			setHistoryCustomersLoading(false);
		};

		void loadHistoryCustomers();
	}, [isCustomerHistoryPage]);

	useEffect(() => {
		if (!isCustomerHistoryPage || !selectedHistoryCustomerId) return;

		let active = true;
		const loadCustomerTickets = async () => {
			setCustomerTicketsLoading(true);
			setCustomerTicketsError("");
			setCustomerHistoryTickets([]);
			const { data, error: queryError } = await supabase
				.from("delivery_tickets")
				.select("*")
				.eq("customer_id", selectedHistoryCustomerId)
				.order("created_at", { ascending: false });

			if (!active) return;
			if (queryError) {
				setCustomerTicketsError(queryError.message);
				setCustomerHistoryTickets([]);
			} else {
				setCustomerHistoryTickets((data ?? []) as Ticket[]);
			}
			setCustomerTicketsLoading(false);
		};

		void loadCustomerTickets();
		return () => {
			active = false;
		};
	}, [isCustomerHistoryPage, selectedHistoryCustomerId]);

	useEffect(() => {
		if (!isCreateTicketPage) return;

		const loadFormOptions = async () => {
			setReferencesLoading(true);
			setReferenceError("");
			const [productsResult, customersResult] = await Promise.all([
				supabase.from("products").select("*"),
				supabase.from("customers").select("*"),
			]);

			if (productsResult.error) {
				setReferenceError(`Products: ${productsResult.error.message}`);
			} else {
				setProducts((productsResult.data ?? []) as Product[]);
			}
			if (customersResult.error) {
				setReferenceError((current) =>
					[current, `Customers: ${customersResult.error.message}`].filter(Boolean).join(" "),
				);
			} else {
				setCustomers((customersResult.data ?? []) as Customer[]);
			}
			setReferencesLoading(false);
		};

		void loadFormOptions();
	}, [isCreateTicketPage]);

	useEffect(() => {
		if (!selectedTicket) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setSelectedTicket(null);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [selectedTicket]);

	const navigate = (event: React.MouseEvent<HTMLAnchorElement>) => {
		if (
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		) return;
		event.preventDefault();
		const destination = event.currentTarget.pathname;
		window.history.pushState({}, "", destination);
		setPath(destination);
	};

	const normalizedSearch = search.trim().toLowerCase();
	const filteredTickets = tickets.filter((ticket) =>
		`${ticket.ticket_number ?? ""} ${ticket.product_name ?? ""}`
			.toLowerCase()
			.includes(normalizedSearch),
	);
	const totalGallons = tickets.reduce(
		(total, ticket) => total + (Number(ticket.quantity) || 0),
		0,
	);
	const totalRevenue = tickets.reduce(
		(total, ticket) => total + (Number(ticket.extended_amount) || 0),
		0,
	);
	const normalizedCustomerSearch = customerSearch.trim().toLowerCase();
	const filteredHistoryCustomers = historyCustomers.filter((customer) =>
		(customer.business_name ?? "").toLowerCase().includes(normalizedCustomerSearch),
	);
	const selectedHistoryCustomer = historyCustomers.find(
		(customer) => String(customer.id ?? customer.customer_id ?? "") === selectedHistoryCustomerId,
	);
	const customerDateStart = (() => {
		const start = new Date();
		if (deliveryDateFilter === "today") {
			start.setHours(0, 0, 0, 0);
			return start;
		}
		if (deliveryDateFilter === "7days") {
			start.setDate(start.getDate() - 6);
			start.setHours(0, 0, 0, 0);
			return start;
		}
		if (deliveryDateFilter === "30days") {
			start.setDate(start.getDate() - 29);
			start.setHours(0, 0, 0, 0);
			return start;
		}
		if (deliveryDateFilter === "year") {
			start.setMonth(0, 1);
			start.setHours(0, 0, 0, 0);
			return start;
		}
		return null;
	})();
	const customerVisibleTickets = customerDateStart
		? customerHistoryTickets.filter((ticket) => {
			const createdAt = ticket.created_at ? new Date(ticket.created_at).getTime() : Number.NaN;
			return Number.isFinite(createdAt) && createdAt >= customerDateStart.getTime();
		})
		: customerHistoryTickets;
	const customerHistoryGallons = customerVisibleTickets.reduce(
		(total, ticket) => total + (Number(ticket.quantity) || 0),
		0,
	);
	const customerHistoryRevenue = customerVisibleTickets.reduce(
		(total, ticket) => total + (Number(ticket.extended_amount) || 0),
		0,
	);
	const selectedCustomer = selectedCustomerIndex === ""
		? null
		: customers[Number(selectedCustomerIndex)] ?? null;
	const selectedProduct = selectedProductIndex === ""
		? null
		: products[Number(selectedProductIndex)] ?? null;
	const selectedProductCode = String(
		selectedProduct?.product_code ?? selectedProduct?.code ?? selectedProduct?.sku ?? "",
	);
	const selectedProductName = String(
		selectedProduct?.product_name ?? selectedProduct?.name ?? selectedProduct?.title ?? "",
	);
	const selectedSellPrice = Number(sellPrice) || 0;
	const quantityValue = Number(quantity) || 0;
	const extendedAmount = quantityValue * selectedSellPrice;

	const formatCurrency = (value: unknown) =>
		new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
		}).format(Number(value) || 0);
	const formatUnitPrice = (value: unknown) =>
		new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
			minimumFractionDigits: 2,
			maximumFractionDigits: 4,
		}).format(Number(value) || 0);
	const formatFourDecimalPrice = (value: unknown) =>
		new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
			minimumFractionDigits: 4,
			maximumFractionDigits: 4,
		}).format(Number(value) || 0);
	const formatDate = (value: unknown) => {
		if (!value) return "—";
		const date = new Date(String(value));
		return Number.isNaN(date.getTime())
			? String(value)
			: new Intl.DateTimeFormat("en-US", {
					dateStyle: "medium",
					timeStyle: "short",
				}).format(date);
	};
	const formatDetail = (value: unknown) => {
		if (value === null || value === undefined || value === "") return "—";
		if (typeof value === "object") return JSON.stringify(value, null, 2);
		return String(value);
	};
	const productLabel = (product: Product, index: number) =>
		String(product.product_name ?? product.name ?? product.title ?? product.id ?? `Product ${index + 1}`);
	const customerLabel = (customer: Customer, index: number) =>
		String(customer.business_name ?? `Customer ${index + 1}`);
	const ticketBusinessName = (ticket: Ticket) =>
		ticket.business_name ?? "—";
	const downloadTicketPdf = async (ticket: Ticket) => {
		const { jsPDF } = await import("jspdf");
		const pdf = new jsPDF({ unit: "pt", format: "letter" });
		const pageWidth = pdf.internal.pageSize.getWidth();
		const margin = 44;
		const contentWidth = pageWidth - margin * 2;
		const columnGap = 24;
		const columnWidth = (contentWidth - columnGap) / 2;
		const drawField = (label: string, value: string, x: number, y: number, width: number) => {
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(8);
			pdf.setTextColor(111, 132, 121);
			pdf.text(label.toUpperCase(), x, y);
			pdf.setFont("helvetica", "normal");
			pdf.setFontSize(11);
			pdf.setTextColor(36, 58, 49);
			const lines = pdf.splitTextToSize(value || "—", width);
			pdf.text(lines, x, y + 15);
			return y + 15 + lines.length * 13;
		};
		const drawSectionTitle = (title: string, y: number) => {
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(8);
			pdf.setTextColor(56, 119, 86);
			pdf.text(title.toUpperCase(), margin, y);
		};

		pdf.setFillColor(25, 67, 51);
		pdf.rect(0, 0, pageWidth, 158, "F");
		pdf.setTextColor(245, 250, 246);
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(18);
		const companyNameLines = pdf.splitTextToSize(companyInfo.companyName || "FUEL DESK", 250);
		pdf.text(companyNameLines, margin, 35);
		pdf.setFont("helvetica", "normal");
		pdf.setFontSize(8);
		const companyInfoLines = [
			companyInfo.address.trim() ? `Address: ${companyInfo.address.trim()}` : "",
			companyCityLine ? `City, State ZIP: ${companyCityLine}` : "",
			companyInfo.phone.trim() ? `Phone: ${companyInfo.phone.trim()}` : "",
		].filter(Boolean);
		let companyInfoY = 45 + companyNameLines.length * 17;
		for (const infoLine of companyInfoLines) {
			const lines = pdf.splitTextToSize(infoLine, 250);
			pdf.text(lines, margin, companyInfoY);
			companyInfoY += lines.length * 11 + 2;
		}
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(13);
		pdf.text("DELIVERY TICKET", pageWidth - margin, 36, { align: "right" });
		pdf.setFontSize(10);
		pdf.text(`Ticket ${formatDetail(ticket.ticket_number)}`, pageWidth - margin, 55, { align: "right" });
		pdf.setFont("helvetica", "normal");
		pdf.setFontSize(9);
		pdf.text(`Created ${formatDate(ticket.created_at)}`, pageWidth - margin, 74, { align: "right" });

		let y = 181;
		drawSectionTitle("Delivery details", y);
		y += 18;
		const customerBottom = drawField("Business name", ticketBusinessName(ticket), margin, y, columnWidth);
		const locationBottom = drawField("Location", formatDetail(ticket.location), margin + columnWidth + columnGap, y, columnWidth);
		y = Math.max(customerBottom, locationBottom) + 22;

		drawSectionTitle("Product", y);
		y += 18;
		const codeBottom = drawField("Product code", formatDetail(ticket.product_code), margin, y, columnWidth);
		const nameBottom = drawField("Product name", formatDetail(ticket.product_name), margin + columnWidth + columnGap, y, columnWidth);
		y = Math.max(codeBottom, nameBottom) + 23;

		const statGap = 10;
		const statWidth = (contentWidth - statGap * 2) / 3;
		const statHeight = 76;
		const stats = [
			["GALLONS", `${(Number(ticket.quantity) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`],
			["PRICE / GALLON", formatUnitPrice(ticket.sell_price)],
			["TOTAL AMOUNT", formatCurrency(ticket.extended_amount)],
		];
		stats.forEach(([label, value], index) => {
			const x = margin + index * (statWidth + statGap);
			pdf.setFillColor(index === 2 ? 235 : 243, index === 2 ? 245 : 248, index === 2 ? 238 : 244);
			pdf.roundedRect(x, y, statWidth, statHeight, 4, 4, "F");
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(8);
			pdf.setTextColor(101, 124, 111);
			pdf.text(label, x + 12, y + 21);
			pdf.setFontSize(index === 2 ? 15 : 14);
			pdf.setTextColor(index === 2 ? 29 : 35, index === 2 ? 105 : 67, index === 2 ? 72 : 53);
			pdf.text(value, x + 12, y + 49);
		});
		y += statHeight + 29;

		drawSectionTitle("Tax codes", y);
		y += 18;
		const exciseBottom = drawField("Excise tax code", formatDetail(ticket.excise_tax_code), margin, y, columnWidth);
		const salesTaxBottom = drawField("Sales tax code", formatDetail(ticket.sales_tax_code), margin + columnWidth + columnGap, y, columnWidth);
		y = Math.max(exciseBottom, salesTaxBottom) + 28;
		pdf.setDrawColor(222, 231, 225);
		pdf.line(margin, y, pageWidth - margin, y);
		pdf.setFont("helvetica", "normal");
		pdf.setFontSize(8);
		pdf.setTextColor(119, 135, 126);
		pdf.text("FUEL DESK  |  DELIVERY RECORD", margin, y + 18);
		const filename = String(ticket.ticket_number ?? "delivery-ticket").replace(/[^a-z0-9_-]/gi, "-");
		pdf.save(`${filename}.pdf`);
	};
	const createTicket = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (
			!selectedProduct ||
			!selectedCustomer ||
			quantityValue <= 0 ||
			!sellPrice.trim() ||
			!Number.isFinite(Number(sellPrice)) ||
			Number(sellPrice) < 0 ||
			!location.trim()
		) return;

		setSavingTicket(true);
		setFormError("");
		setFormMessage("");
		const generatedTicketNumber = generateTicketNumber();

		try {
			const { error: insertError } = await supabase
				.from("delivery_tickets")
				.insert({
					ticket_number: generatedTicketNumber,
					customer_id: selectedCustomer.id ?? selectedCustomer.customer_id,
					location: location.trim(),
					product_code: selectedProductCode,
					product_name: selectedProductName || productLabel(selectedProduct, Number(selectedProductIndex)),
					quantity: quantityValue,
					sell_price: selectedSellPrice,
					extended_amount: extendedAmount,
				});

			if (insertError) {
				setFormError(insertError.message);
				return;
			}

			setFormMessage(`Ticket ${generatedTicketNumber} saved.`);
			setSelectedProductIndex("");
			setSelectedCustomerIndex("");
			setLocation("");
			setQuantity("");
			setSellPrice("");
		} catch (submissionError) {
			setFormError(submissionError instanceof Error ? submissionError.message : "Unable to save ticket.");
		} finally {
			setSavingTicket(false);
		}
	};

	return (
		<div className="app-shell">
			<header className="topbar">
				<a className="brand" href="/create-ticket" onClick={navigate} aria-label="Create ticket">
					<span className="brand-mark">F</span>
					<span>Fuel desk</span>
				</a>
				<nav className="main-nav" aria-label="Main navigation">
						<a
							href="/create-ticket"
						onClick={navigate}
							className={isCreateTicketPage ? "nav-link active" : "nav-link"}
					>
							Create Ticket
					</a>
					<a
						href="/ticket-history"
						onClick={navigate}
						className={isHistoryPage ? "nav-link active" : "nav-link"}
					>
						Ticket History
					</a>
					<a
						href="/customer-history"
						onClick={navigate}
						className={isCustomerHistoryPage ? "nav-link active" : "nav-link"}
					>
						Customer History
					</a>
				</nav>
				<span className="topbar-label">DELIVERY OPERATIONS</span>
			</header>

			<main className="page-content">
				{isHistoryPage ? (
					<>
						<div className="page-heading">
							<div>
								<p className="eyebrow">RECORDS / ALL DELIVERIES</p>
								<h1>Ticket History</h1>
								<p className="heading-description">
									Review delivery tickets, volumes, and recorded sales.
								</p>
							</div>
							<span className="record-count">
								{tickets.length} {tickets.length === 1 ? "ticket" : "tickets"}
							</span>
						</div>

						<section className="summary-grid" aria-label="Ticket summaries">
							<article className="summary-card">
								<span className="summary-label">TOTAL TICKETS</span>
								<strong>{tickets.length.toLocaleString("en-US")}</strong>
								<span className="summary-note">All recorded deliveries</span>
							</article>
							<article className="summary-card gallons-card">
								<span className="summary-label">TOTAL GALLONS</span>
								<strong>{totalGallons.toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong>
								<span className="summary-note">Across all tickets</span>
							</article>
							<article className="summary-card revenue-card">
								<span className="summary-label">TOTAL REVENUE</span>
								<strong>{formatCurrency(totalRevenue)}</strong>
								<span className="summary-note">Recorded extended amount</span>
							</article>
						</section>

						<section className="ticket-section" aria-label="Delivery tickets">
							<div className="table-toolbar">
								<div>
									<h2>All tickets</h2>
									<p>Newest deliveries appear first</p>
								</div>
								<label className="search-box">
									<span className="search-icon" aria-hidden="true">⌕</span>
									<input
										type="search"
										value={search}
										onChange={(event) => setSearch(event.target.value)}
										placeholder="Search tickets or products"
										aria-label="Search by ticket number or product name"
									/>
									{search && (
										<button
											className="clear-search"
											type="button"
											onClick={() => setSearch("")}
											aria-label="Clear search"
										>
											×
										</button>
									)}
								</label>
							</div>

							{error ? (
								<div className="state-message error-state" role="alert">
									<strong>Tickets could not be loaded</strong>
									<span>{error}</span>
								</div>
							) : loading ? (
								<div className="state-message">Loading delivery tickets…</div>
							) : filteredTickets.length === 0 ? (
								<div className="state-message">
									<strong>{search ? "No matching tickets" : "No tickets yet"}</strong>
									<span>
										{search
											? "Try a different ticket number or product name."
											: "Delivery tickets will appear here once they are recorded."}
									</span>
								</div>
							) : (
								<div className="table-scroll">
									<table>
										<thead>
											<tr>
												<th>Ticket number</th>
											<th>Business name</th>
												<th>Product</th>
												<th className="numeric-cell">Quantity</th>
												<th className="numeric-cell">Sell price</th>
												<th className="numeric-cell">Extended amount</th>
												<th>Created</th>
												<th><span className="sr-only">Actions</span></th>
											</tr>
										</thead>
										<tbody>
											{filteredTickets.map((ticket, index) => (
												<tr key={`${ticket.ticket_number ?? "ticket"}-${ticket.created_at ?? index}-${index}`}>
													<td className="ticket-number">{ticket.ticket_number ?? "—"}</td>
													<td>{ticketBusinessName(ticket)}</td>
													<td className="product-cell">{ticket.product_name ?? "—"}</td>
													<td className="numeric-cell">
														{Number(ticket.quantity || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
													</td>
													<td className="numeric-cell">{formatCurrency(ticket.sell_price)}</td>
													<td className="numeric-cell amount-cell">{formatCurrency(ticket.extended_amount)}</td>
													<td className="date-cell">{formatDate(ticket.created_at)}</td>
													<td>
														<button
															className="view-button"
															type="button"
															onClick={() => setSelectedTicket(ticket)}
														>
															View
														</button>
													</td>
												</tr>
											))}
										</tbody>
									</table>
									<div className="table-footer">
										Showing {filteredTickets.length} of {tickets.length} tickets
									</div>
								</div>
							)}
						</section>
					</>
				) : isCustomerHistoryPage ? (
					<>
						<div className="page-heading">
							<div>
								<p className="eyebrow">CUSTOMERS / DELIVERY RECORDS</p>
								<h1>Customer Delivery History</h1>
								<p className="heading-description">Review delivery activity by customer.</p>
							</div>
							{selectedHistoryCustomer && (
								<span className="record-count">{selectedHistoryCustomer.business_name}</span>
							)}
						</div>

						<section className="customer-history-controls" aria-label="Customer and date filters">
							<label className="search-box">
								<span className="search-icon" aria-hidden="true">⌕</span>
								<input
									type="search"
									value={customerSearch}
									onChange={(event) => setCustomerSearch(event.target.value)}
									placeholder="Search customers by business name"
									aria-label="Search customers by business name"
								/>
							</label>
							<label className="form-field customer-select-field">
								<span>Select customer</span>
								<select
									value={selectedHistoryCustomerId}
								onChange={(event) => {
									setSelectedHistoryCustomerId(event.target.value);
									setCustomerHistoryTickets([]);
									setCustomerTicketsError("");
									setCustomerTicketsLoading(false);
								}}
									disabled={historyCustomersLoading || historyCustomers.length === 0}
								>
									<option value="">
										{historyCustomersLoading ? "Loading customers…" : "Choose a customer"}
									</option>
									{filteredHistoryCustomers.map((customer, index) => {
										const customerId = customer.id ?? customer.customer_id;
										return (
											<option key={`${customerId ?? index}-${index}`} value={customerId ?? ""}>
												{customer.business_name || "Unnamed customer"}
											</option>
										);
									})}
								</select>
							</label>
						</section>

						{historyCustomersError ? (
							<div className="state-message error-state" role="alert">
								<strong>Customers could not be loaded</strong>
								<span>{historyCustomersError}</span>
							</div>
						) : historyCustomersLoading ? (
							<div className="state-message">Loading customers…</div>
						) : historyCustomers.length === 0 ? (
							<div className="state-message">
								<strong>No customers available</strong>
								<span>Customers will appear here once they are added.</span>
							</div>
						) : selectedHistoryCustomerId && !selectedHistoryCustomer ? (
							<div className="state-message error-state" role="alert">
								<strong>Customer not found</strong>
								<span>Choose a customer from the list to load delivery history.</span>
							</div>
						) : selectedHistoryCustomer ? (
							<>
								<section className="summary-grid customer-summary-grid" aria-label="Customer delivery summaries">
									<article className="summary-card">
										<span className="summary-label">TOTAL DELIVERIES</span>
										<strong>{customerVisibleTickets.length.toLocaleString("en-US")}</strong>
										<span className="summary-note">For {selectedHistoryCustomer.business_name || "selected customer"}</span>
									</article>
									<article className="summary-card gallons-card">
										<span className="summary-label">TOTAL GALLONS</span>
										<strong>{customerHistoryGallons.toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong>
										<span className="summary-note">For selected date range</span>
									</article>
									<article className="summary-card revenue-card">
										<span className="summary-label">TOTAL REVENUE</span>
										<strong>{formatCurrency(customerHistoryRevenue)}</strong>
										<span className="summary-note">Recorded extended amount</span>
									</article>
									<article className="summary-card date-summary-card">
										<span className="summary-label">LAST DELIVERY DATE</span>
										<strong>{customerVisibleTickets[0]?.created_at ? formatDate(customerVisibleTickets[0].created_at) : "—"}</strong>
										<span className="summary-note">Within selected date range</span>
									</article>
								</section>

								<section className="ticket-section" aria-label="Customer deliveries">
									<div className="table-toolbar customer-table-toolbar">
										<div>
											<h2>Deliveries for {selectedHistoryCustomer.business_name || "selected customer"}</h2>
											<p>Newest deliveries appear first</p>
										</div>
										<label className="form-field customer-date-filter">
											<span>Date range</span>
											<select
												value={deliveryDateFilter}
												onChange={(event) => setDeliveryDateFilter(event.target.value as DeliveryDateFilter)}
											>
												<option value="all">All time</option>
												<option value="today">Today</option>
												<option value="7days">Last 7 days</option>
												<option value="30days">Last 30 days</option>
												<option value="year">This year</option>
												</select>
										</label>
									</div>

									{customerTicketsError ? (
										<div className="state-message error-state" role="alert">
											<strong>Deliveries could not be loaded</strong>
											<span>{customerTicketsError}</span>
										</div>
									) : customerTicketsLoading ? (
										<div className="state-message">Loading deliveries…</div>
									) : customerVisibleTickets.length === 0 ? (
										<div className="state-message">
											<strong>{customerHistoryTickets.length ? "No deliveries in this date range" : "No deliveries yet"}</strong>
											<span>{customerHistoryTickets.length ? "Choose another date range to see more deliveries." : "This customer has no delivery records yet."}</span>
										</div>
									) : (
										<div className="table-scroll">
											<table className="customer-history-table">
												<thead>
													<tr>
														<th>Ticket number</th>
														<th>Delivery date</th>
														<th>Product name</th>
														<th>Location</th>
														<th className="numeric-cell">Quantity</th>
														<th className="numeric-cell">Sell price</th>
														<th className="numeric-cell">Extended amount</th>
														<th><span className="sr-only">Actions</span></th>
													</tr>
												</thead>
												<tbody>
													{customerVisibleTickets.map((ticket, index) => (
														<tr key={`${ticket.ticket_number ?? "ticket"}-${ticket.created_at ?? index}-${index}`}>
															<td className="ticket-number">{ticket.ticket_number ?? "—"}</td>
															<td className="date-cell">{formatDate(ticket.created_at)}</td>
															<td className="product-cell">{ticket.product_name ?? "—"}</td>
															<td>{ticket.location ?? "—"}</td>
															<td className="numeric-cell">{Number(ticket.quantity || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
															<td className="numeric-cell">{formatFourDecimalPrice(ticket.sell_price)}</td>
															<td className="numeric-cell amount-cell">{formatCurrency(ticket.extended_amount)}</td>
															<td>
																<button
																className="view-button"
																type="button"
																onClick={() => setSelectedTicket({
																		...ticket,
																		business_name: selectedHistoryCustomer.business_name,
																	})}
																>
																	View
																</button>
															</td>
														</tr>
													))}
												</tbody>
											</table>
											<div className="table-footer">Showing {customerVisibleTickets.length} deliveries</div>
										</div>
									)}
								</section>
							</>
						) : historyCustomersLoading ? null : (
							<div className="state-message">
								<strong>{normalizedCustomerSearch && filteredHistoryCustomers.length === 0 ? "No matching customers" : "Choose a customer"}</strong>
								<span>{normalizedCustomerSearch && filteredHistoryCustomers.length === 0 ? "Try another business name." : "Search or select a customer to view delivery history."}</span>
							</div>
						)}
					</>
				) : isCreateTicketPage ? (
					<>
						<div className="page-heading">
							<div>
								<p className="eyebrow">DELIVERY OPERATIONS / ENTRY</p>
								<h1>Create Ticket</h1>
								<p className="heading-description">Record a new fuel delivery.</p>
							</div>
						</div>
						<section className="create-ticket-section">
							<div className="create-ticket-heading">
								<h2>Delivery details</h2>
								<p>Product pricing and details populate from the selected product.</p>
							</div>
							{referenceError && <p className="reference-error" role="alert">{referenceError}</p>}
							<form className="ticket-form" onSubmit={(event) => void createTicket(event)}>
								<label className="form-field">
									<span>Business name</span>
									<select
										required
										value={selectedCustomerIndex}
										onChange={(event) => {
											setSelectedCustomerIndex(event.target.value);
											setFormMessage("");
										}}
										disabled={referencesLoading || customers.length === 0}
									>
										<option value="">{referencesLoading ? "Loading customers…" : "Select a customer"}</option>
										{customers.map((customer, index) => (
											<option value={index} key={`${customer.id ?? customer.customer_id ?? index}-${index}`}>
												{customerLabel(customer, index)}
											</option>
										))}
									</select>
								</label>
								<label className="form-field">
									<span>Location</span>
									<input
										required
										value={location}
										onChange={(event) => setLocation(event.target.value)}
										placeholder="Delivery location"
									/>
								</label>
								<label className="form-field">
									<span>Product</span>
									<select
										required
										value={selectedProductIndex}
										onChange={(event) => {
											const nextIndex = event.target.value;
											setSelectedProductIndex(nextIndex);
											setSellPrice(
												nextIndex === ""
												? ""
												: String(products[Number(nextIndex)]?.sell_price ?? ""),
											);
											setFormMessage("");
										}}
										disabled={referencesLoading || products.length === 0}
									>
										<option value="">{referencesLoading ? "Loading products…" : "Select a product"}</option>
										{products.map((product, index) => (
											<option value={index} key={`${product.id ?? productLabel(product, index)}-${index}`}>
												{productLabel(product, index)}
											</option>
										))}
									</select>
								</label>
								<label className="form-field">
									<span>Product code</span>
									<input readOnly value={selectedProductCode} placeholder="Filled from product" />
								</label>
								<label className="form-field">
									<span>Product name</span>
									<input readOnly value={selectedProductName || (selectedProduct ? productLabel(selectedProduct, Number(selectedProductIndex)) : "")} placeholder="Filled from product" />
								</label>
								<label className="form-field">
									<span>Quantity (gallons)</span>
									<input
										required
										type="number"
										min="0.01"
										step="0.01"
										value={quantity}
										onChange={(event) => {
											setQuantity(event.target.value);
											setFormMessage("");
										}}
										placeholder="0.00"
									/>
								</label>
								<label className="form-field">
									<span>Sell price / gallon</span>
									<input
										required
										type="number"
										min="0"
										step="0.0001"
										value={sellPrice}
										onChange={(event) => {
											setSellPrice(event.target.value);
											setFormMessage("");
										}}
										placeholder="Filled from product"
									/>
								</label>
								<label className="form-field calculated-field amount-field">
									<span>Extended amount</span>
									<input readOnly value={selectedProduct && quantityValue > 0 ? formatCurrency(extendedAmount) : ""} placeholder="Calculated automatically" />
								</label>
								<div className="ticket-form-footer">
									<div className="form-feedback" aria-live="polite">
										{formError && <span className="form-error" role="alert">{formError}</span>}
										{formMessage && (
											<span className="form-success">
												{formMessage} <a href="/ticket-history" onClick={navigate}>View Ticket History</a>
											</span>
										)}
										{!referencesLoading && customers.length === 0 && !referenceError && (
											<span className="form-error">No customers are available to select.</span>
										)}
										{!referencesLoading && products.length === 0 && !referenceError && (
											<span className="form-error">No products are available to select.</span>
										)}
									</div>
									<button
										className="submit-ticket-button"
										type="submit"
											disabled={savingTicket || referencesLoading || !selectedProduct || !selectedCustomer || quantityValue <= 0 || !sellPrice.trim() || !Number.isFinite(Number(sellPrice)) || Number(sellPrice) < 0 || !location.trim()}
									>
										{savingTicket ? "Saving…" : "Save ticket"}
									</button>
								</div>
							</form>
						</section>
					</>
				) : (
					<section className="home-panel">
						<p className="eyebrow">DELIVERY OPERATIONS</p>
						<h1>Fuel delivery desk</h1>
						<p className="heading-description">
							Keep every delivery ticket and sales record close at hand.
						</p>
						<a className="primary-link" href="/ticket-history" onClick={navigate}>
							Browse Ticket History <span aria-hidden="true">→</span>
						</a>
					</section>
				)}
			</main>

			{selectedTicket && (
				<div
					className="modal-backdrop"
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) setSelectedTicket(null);
					}}
				>
					<section
						className="ticket-modal"
						role="dialog"
						aria-modal="true"
						aria-labelledby="modal-title"
					>
						<div className="ticket-modal-actions" role="group" aria-label="Ticket actions">
							<button className="ticket-action-button" type="button" onClick={() => window.print()}>
								Print Ticket
							</button>
							<button className="ticket-action-button primary-action" type="button" onClick={() => downloadTicketPdf(selectedTicket)}>
								Download PDF
							</button>
							<button className="ticket-action-button close-action" type="button" onClick={() => setSelectedTicket(null)}>
								Close
							</button>
						</div>
						<article className="ticket-print-content">
							<header className="ticket-paper-header">
								<div className="ticket-company">
									<span className="ticket-company-mark">F</span>
									<div>
										<strong>{companyInfo.companyName || "FUEL DESK"}</strong>
										{companyInfo.address && <span>{companyInfo.address}</span>}
										{companyCityLine && <span>{companyCityLine}</span>}
										{companyInfo.phone && <span>Phone: {companyInfo.phone}</span>}
									</div>
								</div>
								<div className="ticket-heading-meta">
									<h2 id="modal-title">DELIVERY TICKET</h2>
									<strong>{formatDetail(selectedTicket.ticket_number)}</strong>
									<span>Created date: {formatDate(selectedTicket.created_at)}</span>
								</div>
							</header>
							<div className="ticket-paper-body">
								<section className="ticket-info-grid" aria-label="Ticket and customer information">
									<div className="ticket-info-field">
										<span>Ticket Number</span>
										<strong>{formatDetail(selectedTicket.ticket_number)}</strong>
									</div>
									<div className="ticket-info-field">
										<span>Business Name</span>
										<strong>{ticketBusinessName(selectedTicket)}</strong>
									</div>
									<div className="ticket-info-field full-field">
										<span>Location</span>
										<strong>{formatDetail(selectedTicket.location)}</strong>
									</div>
								</section>

								<section className="ticket-product-section" aria-label="Product information">
									<p className="ticket-section-label">Product</p>
									<div className="ticket-product-grid">
										<div className="ticket-info-field">
											<span>Product Code</span>
											<strong>{formatDetail(selectedTicket.product_code)}</strong>
										</div>
										<div className="ticket-info-field">
											<span>Product Name</span>
											<strong>{formatDetail(selectedTicket.product_name)}</strong>
										</div>
									</div>
								</section>

								<section className="ticket-metrics" aria-label="Delivery amounts">
									<div className="ticket-metric">
										<span>Gallons</span>
										<strong>{(Number(selectedTicket.quantity) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong>
									</div>
									<div className="ticket-metric">
									<span>Price per gallon</span>
									<strong>{formatUnitPrice(selectedTicket.sell_price)}</strong>
									</div>
									<div className="ticket-metric total-metric">
										<span>Total amount</span>
									<strong>{formatCurrency(selectedTicket.extended_amount)}</strong>
									</div>
								</section>

								<section className="ticket-tax-grid" aria-label="Tax codes">
									<div className="ticket-info-field">
										<span>Excise Tax Code</span>
										<strong>{formatDetail(selectedTicket.excise_tax_code)}</strong>
									</div>
									<div className="ticket-info-field">
										<span>Sales Tax Code</span>
										<strong>{formatDetail(selectedTicket.sales_tax_code)}</strong>
									</div>
									<div className="ticket-info-field">
										<span>Created Date</span>
										<strong>{formatDate(selectedTicket.created_at)}</strong>
									</div>
								</section>
							</div>
						</article>
					</section>
				</div>
			)}
		</div>
	);
}

export default App;