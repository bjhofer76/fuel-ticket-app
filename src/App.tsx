import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { companyCityLine, companyInfo } from "./lib/company-settings";
import "./App.css";

type TicketLine = {
	id?: string | number;
	ticket_id?: string | number;
	product_code?: string | number | null;
	product_name?: string | null;
	quantity?: number | string | null;
	sell_price?: number | string | null;
	extended_amount?: number | string | null;
	taxable_amount?: number | string | null;
	sales_tax_amount?: number | string | null;
	excise_tax_code?: string | number | null;
	sales_tax_code?: string | number | null;
	sales_tax_treatment?: string | null;
};

type Ticket = {
	id?: string | number;
	ticket_number?: string | number | null;
	customer_id?: string | number | null;
	business_name?: string | null;
	location?: string | null;
	driver_name?: string | null;
	delivery_date?: string | null;
	items?: TicketLine[];
	product_code?: string | number | null;
	product_name?: string | null;
	quantity?: number | string | null;
	sell_price?: number | string | null;
	extended_amount?: number | string | null;
	prompt_pay_discount?: number | string | null;
	discounted_total?: number | string | null;
	taxable_subtotal?: number | string | null;
	sales_tax_total?: number | string | null;
	invoice_subtotal?: number | string | null;
	net_amount_due?: number | string | null;
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
	current_price?: number | string | null;
	excise_tax_code?: string | number | null;
	sales_tax_code?: string | number | null;
	[key: string]: unknown;
};

type Customer = {
	id?: string | number;
	customer_id?: string | number;
	business_name?: string | null;
	[key: string]: unknown;
};

type Driver = {
	name?: string | null;
};

type TaxCode = {
	sales_tax_code?: string | number | null;
	description?: string | null;
	tax_rate?: number | string | null;
	is_taxable?: boolean | null;
};

type ProductLineDraft = {
	id: string;
	productIndex: string;
	quantity: string;
	sellPrice: string;
	salesTaxCodeOverride: string | null;
};

type DeliveryDateFilter = "all" | "today" | "7days" | "30days" | "year";

const getLocalDateInputValue = () => {
	const today = new Date();
	const year = today.getFullYear();
	const month = String(today.getMonth() + 1).padStart(2, "0");
	const day = String(today.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
};

const createProductLineDraft = (): ProductLineDraft => ({
	id: crypto.randomUUID(),
	productIndex: "",
	quantity: "",
	sellPrice: "",
	salesTaxCodeOverride: null,
});

const isDyedDieselProduct = (product: Product) => {
	const productText = [
		product.product_name,
		product.name,
		product.product_code,
		product.code,
		product.sku,
		product.category,
		product.fuel_type,
		product.description,
	]
		.filter((value): value is string => typeof value === "string")
		.join(" ");
	return /\bdyed\b/i.test(productText) && /\bdiesel\b/i.test(productText);
};

const generateTicketNumber = () =>
	`TKT-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;

const ticketLinesFor = (ticket: Ticket): TicketLine[] =>
	ticket.items?.length ? ticket.items : [ticket];

const ticketTotalGallons = (ticket: Ticket) =>
	ticketLinesFor(ticket).reduce((total, item) => total + (Number(item.quantity) || 0), 0);

const ticketSubtotal = (ticket: Ticket) =>
	ticketLinesFor(ticket).reduce((total, item) => total + (Number(item.extended_amount) || 0), 0);

const finiteAmount = (value: unknown): number | undefined => {
	if (value === null || value === undefined || value === "") return undefined;
	const amount = Number(value);
	return Number.isFinite(amount) ? amount : undefined;
};

const ticketTaxableSubtotal = (ticket: Ticket) =>
	finiteAmount(ticket.taxable_subtotal) ??
	ticketLinesFor(ticket).reduce((total, item) => total + (Number(item.taxable_amount) || 0), 0);

const ticketSalesTaxTotal = (ticket: Ticket) =>
	finiteAmount(ticket.sales_tax_total) ??
	ticketLinesFor(ticket).reduce((total, item) => total + (Number(item.sales_tax_amount) || 0), 0);

const ticketInvoiceSubtotal = (ticket: Ticket) =>
	finiteAmount(ticket.invoice_subtotal) ?? ticketSubtotal(ticket);

const ticketPromptPayDiscount = (ticket: Ticket) => {
	const savedDiscount = ticket.prompt_pay_discount;
	return savedDiscount !== null && savedDiscount !== undefined && Number.isFinite(Number(savedDiscount))
		? Number(savedDiscount)
		: ticketTotalGallons(ticket) * 0.07;
};

const ticketNetAmountDue = (ticket: Ticket) =>
	finiteAmount(ticket.net_amount_due) ??
	ticketInvoiceSubtotal(ticket) + ticketSalesTaxTotal(ticket) - ticketPromptPayDiscount(ticket);

const loadTicketLines = async (tickets: Ticket[]) => {
	const ticketIds = tickets
		.map((ticket) => ticket.id)
		.filter((id): id is string | number => id !== null && id !== undefined);
	if (ticketIds.length === 0) {
		return { tickets: tickets.map((ticket) => ({ ...ticket, items: [ticket] })), error: "" };
	}

	const [itemsResult, taxCodesResult] = await Promise.all([
		supabase.from("delivery_ticket_items").select("*").in("ticket_id", ticketIds),
		supabase.from("tax_codes").select("sales_tax_code, description, tax_rate, is_taxable"),
	]);
	const taxCodes = (taxCodesResult.data ?? []) as TaxCode[];
	const taxCodeByCode = new Map(taxCodes.map((taxCode) => [String(taxCode.sales_tax_code ?? "").trim(), taxCode]));
	const itemsByTicket = new Map<string, TicketLine[]>();
	const unconfiguredCodes = new Set<string>();
	const withTax = (item: TicketLine): TicketLine => {
		const code = item.sales_tax_code == null ? "" : String(item.sales_tax_code).trim();
		const taxCode = code ? taxCodeByCode.get(code) : undefined;
		if (code && !taxCode) unconfiguredCodes.add(code);
		const taxable = taxCode?.is_taxable === true;
		const rate = taxCode?.tax_rate == null ? 0 : Number(taxCode.tax_rate);
		const amount = Number(item.extended_amount) || 0;
		return {
			...item,
			sales_tax_treatment: taxCode?.description?.trim() || code || item.sales_tax_treatment || null,
			taxable_amount: finiteAmount(item.taxable_amount) ?? (taxable ? amount : 0),
			sales_tax_amount: finiteAmount(item.sales_tax_amount) ?? (
				taxable && Number.isFinite(rate) && rate >= 0 && rate <= 1
					? Math.round((amount * rate + Number.EPSILON) * 100) / 100
					: 0
			),
		};
	};
	for (const item of (itemsResult.data ?? []) as TicketLine[]) {
		if (item.ticket_id === null || item.ticket_id === undefined) continue;
		const key = String(item.ticket_id);
		itemsByTicket.set(key, [...(itemsByTicket.get(key) ?? []), withTax(item)]);
	}

	const loadedTickets = tickets.map((ticket) => {
		const itemRows = ticket.id === null || ticket.id === undefined
			? undefined
			: itemsByTicket.get(String(ticket.id));
		const items = itemRows?.length ? itemRows : [withTax(ticket)];
		const totalGallons = items.reduce((total, item) => total + (Number(item.quantity) || 0), 0);
		const subtotal = items.reduce((total, item) => total + (Number(item.extended_amount) || 0), 0);
		const taxableSubtotal = finiteAmount(ticket.taxable_subtotal) ??
			items.reduce((total, item) => total + (Number(item.taxable_amount) || 0), 0);
		const salesTaxTotal = finiteAmount(ticket.sales_tax_total) ??
			items.reduce((total, item) => total + (Number(item.sales_tax_amount) || 0), 0);
		const invoiceSubtotal = finiteAmount(ticket.invoice_subtotal) ?? subtotal;
		const promptPayDiscount = finiteAmount(ticket.prompt_pay_discount) ?? totalGallons * 0.07;
		return {
			...ticket,
			items,
			taxable_subtotal: taxableSubtotal,
			sales_tax_total: salesTaxTotal,
			invoice_subtotal: invoiceSubtotal,
			net_amount_due: finiteAmount(ticket.net_amount_due) ?? invoiceSubtotal + salesTaxTotal - promptPayDiscount,
		};
	});

	return {
		tickets: loadedTickets,
		error: [itemsResult.error?.message, taxCodesResult.error?.message,
			unconfiguredCodes.size ? `Unconfigured tax codes: ${[...unconfiguredCodes].join(", ")}` : ""]
			.filter(Boolean).join("; "),
	};
};

function App() {
	const [path, setPath] = useState(window.location.pathname);
	const [tickets, setTickets] = useState<Ticket[]>([]);
	const [products, setProducts] = useState<Product[]>([]);
	const [pricingProducts, setPricingProducts] = useState<Product[]>([]);
	const [pricingDraftPrices, setPricingDraftPrices] = useState<Record<number, string>>({});
	const [pricingLoading, setPricingLoading] = useState(false);
	const [savingPriceIndex, setSavingPriceIndex] = useState<number | null>(null);
	const [pricingError, setPricingError] = useState("");
	const [pricingMessage, setPricingMessage] = useState("");
	const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
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
	const [lineItemsWarning, setLineItemsWarning] = useState("");
	const [productLines, setProductLines] = useState<ProductLineDraft[]>([createProductLineDraft()]);
	const [selectedCustomerIndex, setSelectedCustomerIndex] = useState("");
	const [driverNames, setDriverNames] = useState<string[]>([]);
	const [driverName, setDriverName] = useState("");
	const [deliveryDate, setDeliveryDate] = useState(getLocalDateInputValue);
	const [location, setLocation] = useState("");
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
	const isAdminPricingPage = path === "/admin/pricing";

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
				const { tickets: ticketsWithLines, error: lineItemsError } = await loadTicketLines(ticketRows);
				setLineItemsWarning(lineItemsError
					? `Ticket line or tax details could not be fully loaded (${lineItemsError}). Saved values are shown where available.`
					: "");
				setTickets(ticketsWithLines.map((ticket) => {
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
				const { tickets: ticketsWithLines, error: lineItemsError } = await loadTicketLines((data ?? []) as Ticket[]);
				if (!active) return;
				setLineItemsWarning(lineItemsError
					? `Ticket line or tax details could not be fully loaded (${lineItemsError}). Saved values are shown where available.`
					: "");
				setCustomerHistoryTickets(ticketsWithLines);
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
			const [productsResult, customersResult, driversResult, taxCodesResult] = await Promise.all([
				supabase.from("products").select("*"),
				supabase.from("customers").select("*"),
				supabase.from("drivers").select("name").order("name", { ascending: true }),
				supabase.from("tax_codes").select("sales_tax_code, description, tax_rate, is_taxable"),
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
			if (driversResult.error) {
				setReferenceError((current) =>
					[current, `Drivers: ${driversResult.error.message}`].filter(Boolean).join(" "),
				);
			} else {
				setDriverNames(
					[...new Set(((driversResult.data ?? []) as Driver[])
						.map((driver) => driver.name?.trim())
						.filter((name): name is string => Boolean(name)))],
				);
			}
			if (taxCodesResult.error) {
				setReferenceError((current) =>
					[current, `Tax codes: ${taxCodesResult.error.message}`].filter(Boolean).join(" "),
				);
			} else {
				setTaxCodes((taxCodesResult.data ?? []) as TaxCode[]);
			}
			setReferencesLoading(false);
		};

		void loadFormOptions();
	}, [isCreateTicketPage]);

	useEffect(() => {
		if (!isAdminPricingPage) return;

		let active = true;
		const loadProducts = async () => {
			setPricingLoading(true);
			setPricingError("");
			setPricingMessage("");
			try {
				const { data, error: loadError } = await supabase.from("products").select("*");
				if (!active) return;
				if (loadError) {
					setPricingError(loadError.message);
					return;
				}
				const loadedProducts = (data ?? []) as Product[];
				setPricingProducts(loadedProducts);
				setPricingDraftPrices(Object.fromEntries(
					loadedProducts.map((product, index) => [
						index,
						product.current_price == null || !Number.isFinite(Number(product.current_price))
							? ""
							: Number(product.current_price).toFixed(4),
					]),
				));
			} catch (loadError) {
				if (active) {
					setPricingError(loadError instanceof Error ? loadError.message : "Unable to load products.");
				}
			} finally {
				if (active) setPricingLoading(false);
			}
		};

		void loadProducts();
		return () => {
			active = false;
		};
	}, [isAdminPricingPage]);

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

	const saveProductPrice = async (product: Product, index: number) => {
		const priceText = pricingDraftPrices[index] ?? "";
		if (!/^(?:\d+(?:\.\d{1,4})?|\.\d{1,4})$/.test(priceText)) {
			setPricingError("Enter a price with no more than four decimal places.");
			setPricingMessage("");
			return;
		}
		const price = Number(priceText);
		if (!Number.isFinite(price) || price < 0) {
			setPricingError("Enter a valid price greater than or equal to zero.");
			setPricingMessage("");
			return;
		}
		const productName = String(product.product_name ?? product.name ?? product.title ?? `Product ${index + 1}`);
		const formattedPrice = price.toFixed(4);
		if (!window.confirm(`Save ${productName} current price as $${formattedPrice}?`)) return;

		if (product.id === null || product.id === undefined) {
			setPricingError(`Unable to save ${productName}: no product ID is available.`);
			setPricingMessage("");
			return;
		}

		const numericPrice = Number(formattedPrice);
		setSavingPriceIndex(index);
		setPricingError("");
		setPricingMessage("");
		try {
			const { data: updatedProduct, error: saveError } = await supabase
				.from("products")
				.update({ current_price: numericPrice })
				.eq("id", product.id)
				.select("id, product_code, product_name, current_price")
				.single();
			if (saveError) {
				setPricingError(saveError.code === "PGRST116"
					? "No matching product was updated. Check the products UPDATE policy."
					: saveError.message);
				return;
			}
			if (!updatedProduct) {
				setPricingError("No matching product was updated. Check the products UPDATE policy.");
				return;
			}
			const savedPrice = updatedProduct.current_price;
			if (
				savedPrice === null ||
				savedPrice === undefined ||
				!Number.isFinite(Number(savedPrice)) ||
				Number(savedPrice) !== numericPrice
			) {
				setPricingError(
					`Unable to verify ${productName} price. Expected ${formattedPrice}, received ${savedPrice ?? "NULL"}.`,
				);
				return;
			}
			setPricingProducts((current) => current.map((item, itemIndex) =>
				itemIndex === index ? updatedProduct : item,
			));
			setPricingDraftPrices((current) => ({
				...current,
				[index]: Number(savedPrice).toFixed(4),
			}));
			setPricingMessage(`${productName} price saved.`);
		} catch (saveError) {
			setPricingError(saveError instanceof Error ? saveError.message : `Unable to save ${productName}.`);
		} finally {
			setSavingPriceIndex(null);
		}
	};

	const refreshProductCurrentPrice = async (
		product: Product,
		productIndex: string,
		lineId: string,
		initialSellPrice: string,
	) => {
		if (product.id === null || product.id === undefined) return;
		try {
			const { data, error: priceError } = await supabase
				.from("products")
				.select("current_price")
				.eq("id", product.id)
				.single();
			if (priceError) {
				setReferenceError((current) =>
					[current, `Current price for ${productLabel(product, Number(productIndex))} could not be refreshed: ${priceError.message}`]
						.filter(Boolean).join(" "),
				);
				return;
			}
			if (data.current_price === null || data.current_price === undefined) {
				setReferenceError((current) =>
					[current, `No current price is configured for ${productLabel(product, Number(productIndex))}.`]
						.filter(Boolean).join(" "),
				);
				return;
			}
			const currentPrice = String(data.current_price);
			setProducts((current) => current.map((item, index) =>
				index === Number(productIndex) ? { ...item, current_price: data.current_price } : item,
			));
			setProductLines((current) => current.map((draft) =>
				draft.id === lineId &&
				draft.productIndex === productIndex &&
				draft.sellPrice === initialSellPrice
					? { ...draft, sellPrice: currentPrice }
					: draft,
			));
		} catch (priceError) {
			setReferenceError((current) =>
				[current, `Current price for ${productLabel(product, Number(productIndex))} could not be refreshed: ${priceError instanceof Error ? priceError.message : "Unknown error."}`]
					.filter(Boolean).join(" "),
			);
		}
	};

	const normalizedSearch = search.trim().toLowerCase();
	const filteredTickets = tickets.filter((ticket) =>
		`${ticket.ticket_number ?? ""} ${ticketLinesFor(ticket).map((item) => item.product_name ?? "").join(" ")}`
			.toLowerCase()
			.includes(normalizedSearch),
	);
	const totalGallons = tickets.reduce(
		(total, ticket) => total + ticketLinesFor(ticket).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
		0,
	);
	const totalRevenue = tickets.reduce(
		(total, ticket) => total + ticketLinesFor(ticket).reduce((sum, item) => sum + (Number(item.extended_amount) || 0), 0),
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
			const deliveryDate = ticket.delivery_date
				? new Date(`${ticket.delivery_date.slice(0, 10)}T00:00:00`).getTime()
				: ticket.created_at ? new Date(ticket.created_at).getTime() : Number.NaN;
			return Number.isFinite(deliveryDate) && deliveryDate >= customerDateStart.getTime();
		})
		: customerHistoryTickets;
	const customerHistoryGallons = customerVisibleTickets.reduce(
		(total, ticket) => total + ticketLinesFor(ticket).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
		0,
	);
	const customerHistoryRevenue = customerVisibleTickets.reduce(
		(total, ticket) => total + ticketLinesFor(ticket).reduce((sum, item) => sum + (Number(item.extended_amount) || 0), 0),
		0,
	);
	const selectedCustomer = selectedCustomerIndex === ""
		? null
		: customers[Number(selectedCustomerIndex)] ?? null;
	const taxCodeByCode = new Map(taxCodes.map((taxCode) => [String(taxCode.sales_tax_code ?? "").trim(), taxCode]));
	const dyedDieselTaxCodes = ["FARM_EXEMPT", "SD_STATE", "YANKTON_CITY", "EXEMPT"]
		.flatMap((code) => {
			const taxCode = taxCodeByCode.get(code);
			return taxCode ? [taxCode] : [];
		});
	const preparedProductLines = productLines.map((line) => {
		const product = line.productIndex === "" ? null : products[Number(line.productIndex)] ?? null;
		const quantityValue = Number(line.quantity);
		const sellPriceValue = Number(line.sellPrice);
		const isDyedDiesel = product ? isDyedDieselProduct(product) : false;
		const defaultSalesTaxCode = product?.sales_tax_code == null ? "" : String(product.sales_tax_code).trim();
		const salesTaxCode = isDyedDiesel
			? line.salesTaxCodeOverride ?? "FARM_EXEMPT"
			: defaultSalesTaxCode;
		const taxCode = salesTaxCode ? taxCodeByCode.get(salesTaxCode) : undefined;
		const taxRate = taxCode?.tax_rate == null ? 0 : Number(taxCode.tax_rate);
		const taxCodeMissing = Boolean(salesTaxCode) && !taxCode;
		const taxRateInvalid = Boolean(taxCode?.is_taxable) && (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1);
		const extendedAmount = quantityValue * sellPriceValue;
		const isTaxable = taxCode?.is_taxable === true;
		return {
			...line,
			product,
			productCode: String(product?.product_code ?? product?.code ?? product?.sku ?? ""),
			productName: String(product?.product_name ?? product?.name ?? product?.title ?? ""),
			isDyedDiesel,
			salesTaxCode,
			salesTaxTreatment: taxCode?.description?.trim() || salesTaxCode,
			taxCode,
			taxCodeMissing,
			quantityValue,
			sellPriceValue,
			extendedAmount,
			taxableAmount: isTaxable ? extendedAmount : 0,
			salesTaxAmount: isTaxable && Number.isFinite(taxRate)
				? Math.round((extendedAmount * taxRate + Number.EPSILON) * 100) / 100
				: 0,
			isValid: Boolean(product) && line.quantity.trim() !== "" &&
				Number.isFinite(quantityValue) && quantityValue > 0 &&
				line.sellPrice.trim() !== "" && Number.isFinite(sellPriceValue) && sellPriceValue >= 0 &&
				!taxCodeMissing && !taxRateInvalid,
		};
	});
	const hasValidProductLines = preparedProductLines.length > 0 && preparedProductLines.every((line) => line.isValid);
	const unconfiguredTaxCodes = [...new Set(preparedProductLines.filter((line) => line.taxCodeMissing).map((line) => line.salesTaxCode))];
	const draftTotalGallons = preparedProductLines.reduce(
		(total, line) => total + (Number.isFinite(line.quantityValue) && line.quantityValue > 0 ? line.quantityValue : 0),
		0,
	);
	const draftGrandTotal = preparedProductLines.reduce(
		(total, line) => total + (Number.isFinite(line.extendedAmount) && line.extendedAmount > 0 ? line.extendedAmount : 0),
		0,
	);
	const draftTaxableSubtotal = preparedProductLines.reduce(
		(total, line) => total + line.taxableAmount,
		0,
	);
	const draftSalesTaxTotal = preparedProductLines.reduce(
		(total, line) => total + line.salesTaxAmount,
		0,
	);
	const draftInvoiceSubtotal = draftGrandTotal;
	const draftPromptPayDiscount = draftTotalGallons * 0.07;
	const draftNetAmountDue = draftInvoiceSubtotal + draftSalesTaxTotal - draftPromptPayDiscount;

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
	const formatDeliveryDate = (value: unknown) => {
		if (!value) return "—";
		const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
		return Number.isNaN(date.getTime())
			? String(value)
			: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
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
		const pageHeight = pdf.internal.pageSize.getHeight();
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
		const ensurePdfSpace = (height: number) => {
			if (y + height > pageHeight - margin) {
				pdf.addPage();
				y = margin;
			}
		};
		drawSectionTitle("Delivery details", y);
		y += 18;
		const customerBottom = drawField("Business name", ticketBusinessName(ticket), margin, y, columnWidth);
		const locationBottom = drawField("Location", formatDetail(ticket.location), margin + columnWidth + columnGap, y, columnWidth);
		y = Math.max(customerBottom, locationBottom) + 18;
		const driverBottom = drawField("Driver name", formatDetail(ticket.driver_name), margin, y, columnWidth);
		const deliveryDateBottom = drawField("Delivery date", formatDeliveryDate(ticket.delivery_date), margin + columnWidth + columnGap, y, columnWidth);
		y = Math.max(driverBottom, deliveryDateBottom) + 22;

		drawSectionTitle("Product lines", y);
		y += 18;
		const ticketItems = ticketLinesFor(ticket);
		const itemGap = 12;
		const itemColumnWidth = (contentWidth - itemGap * 2) / 3;
		for (const [index, item] of ticketItems.entries()) {
			ensurePdfSpace(112);
			const productBottom = drawField(`Product ${index + 1}`, formatDetail(item.product_name), margin, y, columnWidth);
			const codeBottom = drawField("Product code", formatDetail(item.product_code), margin + columnWidth + columnGap, y, columnWidth);
			y = Math.max(productBottom, codeBottom) + 8;
			const quantityBottom = drawField("Gallons", Number(item.quantity || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }), margin, y, itemColumnWidth);
			const priceBottom = drawField("Price / gallon", formatUnitPrice(item.sell_price), margin + itemColumnWidth + itemGap, y, itemColumnWidth);
			const amountBottom = drawField("Line amount", formatCurrency(item.extended_amount), margin + (itemColumnWidth + itemGap) * 2, y, itemColumnWidth);
			y = Math.max(quantityBottom, priceBottom, amountBottom) + 8;
			const taxableBottom = drawField("Taxable amount", formatCurrency(item.taxable_amount), margin, y, columnWidth);
			const salesTaxAmountBottom = drawField("Sales tax", formatCurrency(item.sales_tax_amount), margin + columnWidth + columnGap, y, columnWidth);
			y = Math.max(taxableBottom, salesTaxAmountBottom) + 8;
			const exciseBottom = drawField("Excise tax code", formatDetail(item.excise_tax_code ?? ticket.excise_tax_code), margin, y, columnWidth);
			const taxTreatmentBottom = drawField("Tax treatment", formatDetail(item.sales_tax_treatment ?? item.sales_tax_code ?? ticket.sales_tax_code), margin + columnWidth + columnGap, y, columnWidth);
			y = Math.max(exciseBottom, taxTreatmentBottom) + 14;
		}

		const statGap = 10;
		const statWidth = (contentWidth - statGap * 2) / 3;
		const statHeight = 66;
		ensurePdfSpace((statHeight + statGap) * 2 + 20);
		const stats = [
			["TOTAL GALLONS", `${ticketItems.reduce((total, item) => total + (Number(item.quantity) || 0), 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`],
			["TAXABLE SUBTOTAL", formatCurrency(ticketTaxableSubtotal(ticket))],
			["SALES TAX", formatCurrency(ticketSalesTaxTotal(ticket))],
			["INVOICE SUBTOTAL", formatCurrency(ticketInvoiceSubtotal(ticket))],
			["PROMPT PAY DISCOUNT", formatCurrency(ticketPromptPayDiscount(ticket))],
			["NET AMOUNT DUE", formatCurrency(ticketNetAmountDue(ticket))],
		];
		stats.forEach(([label, value], index) => {
			const x = margin + (index % 3) * (statWidth + statGap);
			const yOffset = Math.floor(index / 3) * (statHeight + statGap);
			pdf.setFillColor(index === 5 ? 235 : 243, index === 5 ? 245 : 248, index === 5 ? 238 : 244);
			pdf.roundedRect(x, y + yOffset, statWidth, statHeight, 4, 4, "F");
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(8);
			pdf.setTextColor(101, 124, 111);
			pdf.text(label, x + 12, y + yOffset + 19);
			pdf.setFontSize(index === 5 ? 13 : 12);
			pdf.setTextColor(index === 5 ? 29 : 35, index === 5 ? 105 : 67, index === 5 ? 72 : 53);
			pdf.text(value, x + 12, y + yOffset + 46);
		});
		y += (statHeight + statGap) * 2 + 20;

		ensurePdfSpace(58);
		y += 8;
		pdf.setDrawColor(222, 231, 225);
		pdf.line(margin, y, pageWidth - margin, y);
		pdf.setFont("helvetica", "normal");
		pdf.setFontSize(8);
		pdf.setTextColor(119, 135, 126);
		pdf.text("FUEL DESK  |  DELIVERY RECORD", margin, y + 18);
		pdf.setTextColor(56, 82, 69);
		pdf.text("Less 7¢ per gallon if paid within 10 days.", margin, y + 34);
		const filename = String(ticket.ticket_number ?? "delivery-ticket").replace(/[^a-z0-9_-]/gi, "-");
		pdf.save(`${filename}.pdf`);
	};
	const createTicket = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (
			!selectedCustomer ||
			!driverName ||
			!deliveryDate ||
			!hasValidProductLines ||
			!location.trim()
		) return;

		setSavingTicket(true);
		setFormError("");
		setFormMessage("");
		const generatedTicketNumber = generateTicketNumber();
		const firstLine = preparedProductLines[0];
		const promptPayDiscount = draftTotalGallons * 0.07;
		const discountedTotal = draftGrandTotal - promptPayDiscount;
		const netAmountDue = draftInvoiceSubtotal + draftSalesTaxTotal - promptPayDiscount;

		try {
			const { data: insertedTicket, error: insertError } = await supabase
				.from("delivery_tickets")
				.insert({
					ticket_number: generatedTicketNumber,
					customer_id: selectedCustomer.id ?? selectedCustomer.customer_id,
					driver_name: driverName,
					delivery_date: deliveryDate,
					location: location.trim(),
					product_code: firstLine.productCode,
					product_name: firstLine.productName || productLabel(firstLine.product!, Number(firstLine.productIndex)),
					excise_tax_code: firstLine.product?.excise_tax_code,
					sales_tax_code: firstLine.salesTaxCode,
					quantity: draftTotalGallons,
					sell_price: firstLine.sellPriceValue,
					extended_amount: draftGrandTotal,
					taxable_subtotal: draftTaxableSubtotal,
					sales_tax_total: draftSalesTaxTotal,
					invoice_subtotal: draftInvoiceSubtotal,
					prompt_pay_discount: promptPayDiscount,
					discounted_total: discountedTotal,
					net_amount_due: netAmountDue,
				})
				.select("id")
				.single();

			if (insertError) {
				setFormError(insertError.message);
				return;
			}
			if (insertedTicket?.id === undefined || insertedTicket.id === null) {
				setFormError("The ticket was created, but its ID could not be retrieved for saving product lines.");
				return;
			}

			const lineItems = preparedProductLines.map((line) => ({
				ticket_id: insertedTicket.id,
				product_code: line.productCode,
				product_name: line.productName || productLabel(line.product!, Number(line.productIndex)),
				quantity: line.quantityValue,
				sell_price: line.sellPriceValue,
				extended_amount: line.extendedAmount,
				taxable_amount: line.taxableAmount,
				sales_tax_amount: line.salesTaxAmount,
				excise_tax_code: line.product?.excise_tax_code,
				sales_tax_code: line.salesTaxCode,
			}));
			const { error: lineItemsError } = await supabase
				.from("delivery_ticket_items")
				.insert(lineItems);

			if (lineItemsError) {
				setFormError(`Ticket ${generatedTicketNumber} was created, but its product lines could not be saved: ${lineItemsError.message}`);
				return;
			}

			setFormMessage(`Ticket ${generatedTicketNumber} saved.`);
			setProductLines([createProductLineDraft()]);
			setSelectedCustomerIndex("");
			setDriverName("");
			setDeliveryDate(getLocalDateInputValue());
			setLocation("");
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
					<a
						href="/admin/pricing"
						onClick={navigate}
						className={isAdminPricingPage ? "nav-link active" : "nav-link"}
					>
						Admin Pricing
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
							{lineItemsWarning && <p className="line-items-warning" role="alert">{lineItemsWarning}</p>}
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
													<th>Driver name</th>
													<th>Delivery date</th>
												<th>Product</th>
												<th>Tax treatment</th>
												<th className="numeric-cell">Quantity</th>
												<th className="numeric-cell">Sell price</th>
												<th className="numeric-cell">Extended amount</th>
											<th className="numeric-cell">Taxable subtotal</th>
											<th className="numeric-cell">Sales tax</th>
											<th className="numeric-cell">Invoice subtotal</th>
												<th className="numeric-cell">Prompt Pay Discount</th>
												<th className="numeric-cell">Net amount due</th>
												<th>Created</th>
												<th><span className="sr-only">Actions</span></th>
											</tr>
										</thead>
										<tbody>
										{filteredTickets.flatMap((ticket, index) => {
											const lines = ticketLinesFor(ticket);
											return lines.map((item, itemIndex) => (
												<tr key={`${ticket.ticket_number ?? "ticket"}-${ticket.created_at ?? index}-${item.id ?? itemIndex}`}>
													{itemIndex === 0 && <td className="ticket-number" rowSpan={lines.length}>{ticket.ticket_number ?? "—"}</td>}
													{itemIndex === 0 && <td rowSpan={lines.length}>{ticketBusinessName(ticket)}</td>}
													{itemIndex === 0 && <td rowSpan={lines.length}>{formatDetail(ticket.driver_name)}</td>}
													{itemIndex === 0 && <td className="date-cell" rowSpan={lines.length}>{formatDeliveryDate(ticket.delivery_date)}</td>}
													<td className="product-cell">{item.product_name ?? "—"}</td>
													<td>{formatDetail(item.sales_tax_treatment ?? item.sales_tax_code)}</td>
													<td className="numeric-cell">{Number(item.quantity || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
													<td className="numeric-cell">{formatFourDecimalPrice(item.sell_price)}</td>
													<td className="numeric-cell amount-cell">{formatCurrency(item.extended_amount)}</td>
													{itemIndex === 0 && <td className="numeric-cell" rowSpan={lines.length}>{formatCurrency(ticketTaxableSubtotal(ticket))}</td>}
													{itemIndex === 0 && <td className="numeric-cell" rowSpan={lines.length}>{formatCurrency(ticketSalesTaxTotal(ticket))}</td>}
													{itemIndex === 0 && <td className="numeric-cell" rowSpan={lines.length}>{formatCurrency(ticketInvoiceSubtotal(ticket))}</td>}
													{itemIndex === 0 && <td className="numeric-cell" rowSpan={lines.length}>{formatCurrency(ticketPromptPayDiscount(ticket))}</td>}
													{itemIndex === 0 && <td className="numeric-cell amount-cell" rowSpan={lines.length}>{formatCurrency(ticketNetAmountDue(ticket))}</td>}
													{itemIndex === 0 && <td className="date-cell" rowSpan={lines.length}>{formatDate(ticket.created_at)}</td>}
													{itemIndex === 0 && (
														<td rowSpan={lines.length}>
															<button className="view-button" type="button" onClick={() => setSelectedTicket(ticket)}>View</button>
														</td>
													)}
												</tr>
											));
										})}
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
										<strong>{customerVisibleTickets[0]?.delivery_date ? formatDeliveryDate(customerVisibleTickets[0].delivery_date) : customerVisibleTickets[0]?.created_at ? formatDate(customerVisibleTickets[0].created_at) : "—"}</strong>
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
														<th>Driver name</th>
														<th>Product name</th>
														<th>Tax treatment</th>
														<th>Location</th>
														<th className="numeric-cell">Quantity</th>
														<th className="numeric-cell">Sell price</th>
														<th className="numeric-cell">Extended amount</th>
														<th className="numeric-cell">Taxable subtotal</th>
														<th className="numeric-cell">Sales tax</th>
														<th className="numeric-cell">Invoice subtotal</th>
														<th className="numeric-cell">Prompt Pay Discount</th>
														<th className="numeric-cell">Net amount due</th>
														<th><span className="sr-only">Actions</span></th>
													</tr>
												</thead>
												<tbody>
													{customerVisibleTickets.flatMap((ticket, index) => {
														const lines = ticketLinesFor(ticket);
														return lines.map((item, itemIndex) => (
															<tr key={`${ticket.ticket_number ?? "ticket"}-${ticket.created_at ?? index}-${item.id ?? itemIndex}`}>
																{itemIndex === 0 && <td className="ticket-number" rowSpan={lines.length}>{ticket.ticket_number ?? "—"}</td>}
																{itemIndex === 0 && <td className="date-cell" rowSpan={lines.length}>{ticket.delivery_date ? formatDeliveryDate(ticket.delivery_date) : formatDate(ticket.created_at)}</td>}
																{itemIndex === 0 && <td rowSpan={lines.length}>{formatDetail(ticket.driver_name)}</td>}
																<td className="product-cell">{item.product_name ?? "—"}</td>
																<td>{formatDetail(item.sales_tax_treatment ?? item.sales_tax_code)}</td>
																<td>{ticket.location ?? "—"}</td>
																<td className="numeric-cell">{Number(item.quantity || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
																<td className="numeric-cell">{formatFourDecimalPrice(item.sell_price)}</td>
																<td className="numeric-cell amount-cell">{formatCurrency(item.extended_amount)}</td>
																{itemIndex === 0 && <td className="numeric-cell" rowSpan={lines.length}>{formatCurrency(ticketTaxableSubtotal(ticket))}</td>}
																{itemIndex === 0 && <td className="numeric-cell" rowSpan={lines.length}>{formatCurrency(ticketSalesTaxTotal(ticket))}</td>}
																{itemIndex === 0 && <td className="numeric-cell" rowSpan={lines.length}>{formatCurrency(ticketInvoiceSubtotal(ticket))}</td>}
																{itemIndex === 0 && <td className="numeric-cell" rowSpan={lines.length}>{formatCurrency(ticketPromptPayDiscount(ticket))}</td>}
																{itemIndex === 0 && <td className="numeric-cell amount-cell" rowSpan={lines.length}>{formatCurrency(ticketNetAmountDue(ticket))}</td>}
																{itemIndex === 0 && (
																	<td rowSpan={lines.length}>
																		<button className="view-button" type="button" onClick={() => setSelectedTicket({ ...ticket, business_name: selectedHistoryCustomer.business_name })}>View</button>
																	</td>
																)}
															</tr>
														));
													})}
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
				) : isAdminPricingPage ? (
					<>
						<div className="page-heading">
							<div>
								<p className="eyebrow">ADMINISTRATION / PRODUCTS</p>
								<h1>Admin Product Pricing</h1>
								<p className="heading-description">Review and update current product prices.</p>
							</div>
						</div>
						<section className="ticket-section pricing-section">
							<div className="table-scroll">
								<table className="pricing-table">
									<thead>
										<tr>
											<th>Product Name</th>
											<th>Product Code</th>
											<th>Current Price</th>
											<th><span className="sr-only">Actions</span></th>
										</tr>
									</thead>
									<tbody>
										{pricingProducts.map((product, index) => {
											const priceText = pricingDraftPrices[index] ?? "";
											const currentPrice = product.current_price == null ? "" : Number(product.current_price).toFixed(4);
											return (
												<tr key={String(product.id ?? product.product_code ?? index)}>
													<td className="product-cell">{String(product.product_name ?? product.name ?? product.title ?? `Product ${index + 1}`)}</td>
													<td>{String(product.product_code ?? product.code ?? product.sku ?? "—")}</td>
													<td>
														<label className="pricing-input-label">
															<span className="sr-only">Current Price for {String(product.product_name ?? product.name ?? `Product ${index + 1}`)}</span>
															<input
																type="number"
																min="0"
																step="0.0001"
																value={priceText}
																placeholder={currentPrice || "0.0000"}
																onChange={(event) => {
																	setPricingDraftPrices((current) => ({ ...current, [index]: event.target.value }));
																	setPricingError("");
																	setPricingMessage("");
																}}
															/>
														</label>
													</td>
													<td>
														<button
															className="view-button"
															type="button"
															disabled={savingPriceIndex !== null || priceText === currentPrice}
															onClick={() => void saveProductPrice(product, index)}
														>
															{savingPriceIndex === index ? "Saving…" : "Save"}
														</button>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
							<div className="pricing-feedback" aria-live="polite">
								{pricingLoading && <span>Loading products…</span>}
								{!pricingLoading && pricingProducts.length === 0 && !pricingError && <span>No products are available.</span>}
								{pricingError && <span className="form-error" role="alert">{pricingError}</span>}
								{pricingMessage && <span className="form-success" role="status">{pricingMessage}</span>}
							</div>
						</section>
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
									<span>Driver name</span>
									<select
										required
										value={driverName}
										onChange={(event) => {
											setDriverName(event.target.value);
											setFormMessage("");
										}}
										disabled={referencesLoading || driverNames.length === 0}
									>
										<option value="">{referencesLoading ? "Loading drivers…" : "Select a driver"}</option>
										{driverNames.map((name) => <option value={name} key={name}>{name}</option>)}
									</select>
								</label>
								<label className="form-field">
									<span>Delivery date</span>
									<input
										required
										type="date"
										value={deliveryDate}
										onChange={(event) => {
											setDeliveryDate(event.target.value);
											setFormMessage("");
										}}
									/>
								</label>
								<div className="product-lines-field">
									<div className="product-lines-heading">
										<h3>Product lines</h3>
										<button
											className="add-product-button"
											type="button"
											onClick={() => setProductLines((current) => [...current, createProductLineDraft()])}
										>
											<span aria-hidden="true">+</span> Add Product
										</button>
									</div>
									<div className="product-lines-list">
										{preparedProductLines.map((line, index) => (
											<div className={line.isDyedDiesel ? "product-line-row tax-treatment-row" : "product-line-row"} key={line.id}>
												<label className="form-field product-line-product">
													<span>Product {index + 1}</span>
													<select
														required
														value={line.productIndex}
														onChange={(event) => {
															const productIndex = event.target.value;
															const product = productIndex === "" ? null : products[Number(productIndex)] ?? null;
															const initialSellPrice = product?.current_price == null ? "" : String(product.current_price);
															setProductLines((current) => current.map((draft) => draft.id === line.id
																? {
																	...draft,
																	productIndex,
																	sellPrice: initialSellPrice,
																	salesTaxCodeOverride: product && isDyedDieselProduct(product) ? "FARM_EXEMPT" : null,
																}
																: draft));
															if (product) {
																void refreshProductCurrentPrice(product, productIndex, line.id, initialSellPrice);
															}
															setFormMessage("");
														}}
														disabled={referencesLoading || products.length === 0}
													>
														<option value="">{referencesLoading ? "Loading products…" : "Select a product"}</option>
														{products.map((product, productIndex) => (
															<option value={productIndex} key={`${product.id ?? productLabel(product, productIndex)}-${productIndex}`}>
																{productLabel(product, productIndex)}
															</option>
														))}
													</select>
												</label>
												{line.isDyedDiesel && (
													<label className="form-field product-tax-treatment">
														<span>Tax Treatment</span>
														<select
															required
															value={line.salesTaxCode}
															onChange={(event) => {
																const salesTaxCodeOverride = event.target.value;
																setProductLines((current) => current.map((draft) => draft.id === line.id ? { ...draft, salesTaxCodeOverride } : draft));
																setFormMessage("");
															}}
															disabled={referencesLoading}
														>
															{dyedDieselTaxCodes
																.map((taxCode) => {
																	const code = String(taxCode.sales_tax_code ?? "").trim();
																	return <option value={code} key={code}>{code}</option>;
																})}
														</select>
													</label>
												)}
												<label className="form-field">
													<span>Quantity (gallons)</span>
													<input
														required
														type="number"
														min="0.01"
														step="0.01"
														value={line.quantity}
														onChange={(event) => {
															const quantity = event.target.value;
															setProductLines((current) => current.map((draft) => draft.id === line.id ? { ...draft, quantity } : draft));
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
														value={line.sellPrice}
														onChange={(event) => {
															const sellPrice = event.target.value;
															setProductLines((current) => current.map((draft) => draft.id === line.id ? { ...draft, sellPrice } : draft));
															setFormMessage("");
														}}
														placeholder="0.0000"
													/>
												</label>
												<label className="form-field calculated-field amount-field">
													<span>Extended amount</span>
													<input readOnly value={line.isValid ? formatCurrency(line.extendedAmount) : ""} placeholder="Calculated automatically" />
												</label>
												<label className="form-field calculated-field amount-field">
													<span>Sales tax</span>
													<input readOnly value={line.isValid ? formatCurrency(line.salesTaxAmount) : ""} placeholder={line.taxCodeMissing ? "Tax code not configured" : "Calculated automatically"} />
												</label>
												<button
													className="remove-product-button"
													type="button"
													aria-label={`Remove product line ${index + 1}`}
													onClick={() => setProductLines((current) => current.filter((draft) => draft.id !== line.id))}
												>
													Remove
												</button>
											</div>
										))}
									</div>
									<div className="product-lines-total">
										<span>Total gallons <strong>{draftTotalGallons.toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong></span>
										<span>Taxable subtotal <strong>{formatCurrency(draftTaxableSubtotal)}</strong></span>
										<span>Sales tax <strong>{formatCurrency(draftSalesTaxTotal)}</strong></span>
										<span>Invoice subtotal <strong>{formatCurrency(draftInvoiceSubtotal)}</strong></span>
										<span>Prompt Pay Discount (7¢/gal if paid within 10 days) <strong>{formatCurrency(draftPromptPayDiscount)}</strong></span>
										<span>Net amount due <strong>{formatCurrency(draftNetAmountDue)}</strong></span>
									</div>
								</div>
								{unconfiguredTaxCodes.length > 0 && (
									<p className="reference-error" role="alert">
										Configure tax code{unconfiguredTaxCodes.length === 1 ? "" : "s"} {unconfiguredTaxCodes.join(", ")} in the tax_codes table before saving.
									</p>
								)}
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
										{!referencesLoading && driverNames.length === 0 && !referenceError && (
											<span className="form-error">No drivers are available to select.</span>
										)}
									</div>
									<button
										className="submit-ticket-button"
										type="submit"
											disabled={savingTicket || referencesLoading || !hasValidProductLines || !selectedCustomer || !driverName || !deliveryDate || !location.trim()}
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
					<div className="ticket-info-field">
						<span>Driver Name</span>
						<strong>{formatDetail(selectedTicket.driver_name)}</strong>
					</div>
					<div className="ticket-info-field">
						<span>Delivery Date</span>
						<strong>{formatDeliveryDate(selectedTicket.delivery_date)}</strong>
					</div>
									<div className="ticket-info-field full-field">
										<span>Location</span>
										<strong>{formatDetail(selectedTicket.location)}</strong>
									</div>
								</section>

								<section className="ticket-product-section" aria-label="Product information">
									<p className="ticket-section-label">Product lines</p>
									<div className="ticket-line-list">
										{ticketLinesFor(selectedTicket).map((item, index) => (
											<article className="ticket-line-card" key={`${item.id ?? index}-${index}`}>
												<div className="ticket-line-title">
													<div className="ticket-info-field">
														<span>Product {index + 1}</span>
														<strong>{formatDetail(item.product_name)}</strong>
													</div>
													<div className="ticket-info-field">
														<span>Product Code</span>
														<strong>{formatDetail(item.product_code)}</strong>
													</div>
												</div>
												<div className="ticket-line-details">
													<div className="ticket-info-field">
														<span>Gallons</span>
														<strong>{Number(item.quantity || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong>
													</div>
													<div className="ticket-info-field">
														<span>Price per gallon</span>
														<strong>{formatUnitPrice(item.sell_price)}</strong>
													</div>
													<div className="ticket-info-field">
														<span>Line amount</span>
														<strong>{formatCurrency(item.extended_amount)}</strong>
													</div>
															<div className="ticket-info-field">
																<span>Taxable amount</span>
																<strong>{formatCurrency(item.taxable_amount)}</strong>
															</div>
															<div className="ticket-info-field">
																<span>Sales tax</span>
																<strong>{formatCurrency(item.sales_tax_amount)}</strong>
															</div>
												</div>
												<div className="ticket-line-details ticket-line-tax-details">
													<div className="ticket-info-field">
														<span>Excise Tax Code</span>
														<strong>{formatDetail(item.excise_tax_code ?? selectedTicket.excise_tax_code)}</strong>
													</div>
													<div className="ticket-info-field">
																<span>Tax Treatment</span>
																<strong>{formatDetail(item.sales_tax_treatment ?? item.sales_tax_code ?? selectedTicket.sales_tax_code)}</strong>
													</div>
												</div>
											</article>
										))}
									</div>
								</section>

								<section className="ticket-metrics" aria-label="Delivery amounts">
									<div className="ticket-metric">
										<span>Total gallons</span>
										<strong>{ticketLinesFor(selectedTicket).reduce((total, item) => total + (Number(item.quantity) || 0), 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong>
									</div>
									<div className="ticket-metric">
										<span>Taxable subtotal</span>
										<strong>{formatCurrency(ticketTaxableSubtotal(selectedTicket))}</strong>
									</div>
									<div className="ticket-metric">
										<span>Sales tax</span>
										<strong>{formatCurrency(ticketSalesTaxTotal(selectedTicket))}</strong>
									</div>
									<div className="ticket-metric">
										<span>Invoice subtotal</span>
										<strong>{formatCurrency(ticketInvoiceSubtotal(selectedTicket))}</strong>
									</div>
									<div className="ticket-metric">
										<span>Prompt Pay Discount</span>
										<strong>{formatCurrency(ticketPromptPayDiscount(selectedTicket))}</strong>
									</div>
									<div className="ticket-metric total-metric">
										<span>Net amount due</span>
										<strong>{formatCurrency(ticketNetAmountDue(selectedTicket))}</strong>
									</div>
								</section>

								<section className="ticket-tax-grid" aria-label="Tax codes">
									<p className="ticket-payment-terms">Less 7¢ per gallon if paid within 10 days.</p>
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
