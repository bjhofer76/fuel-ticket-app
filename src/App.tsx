import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { companyCityLine, companyInfo } from "./lib/company-settings";
import { LubeTicketPage } from "./LubeTicketPage";
import gerstnerOilLogoUrl from "./assets/gerstner-oil-logo.png";
import gerstnerOilLogoSvgUrl from "./assets/gerstner-oil-logo.svg";
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
	federal_fuel_tax?: number | string | null;
	state_fuel_tax?: number | string | null;
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
	ticket_type?: "FUEL" | "LUBE" | null;
	[key: string]: unknown;
};

type Product = {
	id?: string | number;
	product_code?: string | null;
	product_name?: string | null;
	name?: string | null;
	code?: string | null;
	sku?: string | null;
	fuel_type?: string | null;
	sell_price?: number | string | null;
	current_price?: number | string | null;
	excise_tax_code?: string | number | null;
	sales_tax_code?: string | number | null;
	federal_fuel_tax?: number | string | null;
	state_fuel_tax?: number | string | null;
	product_type?: "FUEL" | "LUBE" | null;
	quickbooks_tax_code?: string | null;
	[key: string]: unknown;
};

type FuelType = "GASOLINE" | "ROAD_DIESEL" | "DYED_DIESEL";

type LocationFuelTaxRate = {
	fuel_type: string;
	state_fuel_tax: number | string | null;
};

type Customer = {
	id?: string | number;
	business_name?: string | null;
	nexgen_customer_id?: string | null;
	customer_number?: string | number | null;
	classification?: string | null;
	terms?: string | null;
	salesperson?: string | null;
	default_driver?: string | null;
	credit_limit?: number | string | null;
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

const firstTicketNumber = 100000;
const ticketNumberPageSize = 1000;
const customerPageSize = 1000;

const fetchAllCustomers = async () => {
	const allCustomers: Customer[] = [];
	let offset = 0;

	while (true) {
		const { data, error: queryError } = await supabase
			.from("customers")
			.select("id, business_name, nexgen_customer_id, customer_number, billing_address, city, state, zip")
			.order("id", { ascending: true })
			.range(offset, offset + customerPageSize - 1);
		if (queryError) throw new Error(queryError.message);

		const page = (data ?? []) as Customer[];
		allCustomers.push(...page);
		if (page.length < customerPageSize) return allCustomers;
		offset += customerPageSize;
	}
};

const fetchNextTicketNumber = async () => {
	let nextOffset = 0;
	let highestTicketNumber = firstTicketNumber - 1;

	while (true) {
		const { data, error: queryError } = await supabase
			.from("delivery_tickets")
			.select("ticket_number")
			.order("id", { ascending: true })
			.range(nextOffset, nextOffset + ticketNumberPageSize - 1);
		if (queryError) throw new Error(`Unable to load ticket numbers: ${queryError.message}`);

		const rows = (data ?? []) as Array<{ ticket_number?: string | number | null }>;
		for (const row of rows) {
			const ticketNumber = row.ticket_number;
			const normalizedNumber = typeof ticketNumber === "string" ? ticketNumber.trim() : ticketNumber;
			if (
				(typeof normalizedNumber !== "string" && typeof normalizedNumber !== "number") ||
				(typeof normalizedNumber === "string" && !/^\d+$/.test(normalizedNumber))
			) continue;
			const numericTicketNumber = Number(normalizedNumber);
			if (Number.isSafeInteger(numericTicketNumber) && numericTicketNumber > highestTicketNumber) {
				highestTicketNumber = numericTicketNumber;
			}
		}

		if (rows.length < ticketNumberPageSize) break;
		nextOffset += ticketNumberPageSize;
	}

	if (highestTicketNumber >= Number.MAX_SAFE_INTEGER) {
		throw new Error("The next ticket number exceeds the supported numeric range.");
	}
	return highestTicketNumber + 1;
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

const isFuelType = (value: string): value is FuelType =>
	value === "GASOLINE" || value === "ROAD_DIESEL" || value === "DYED_DIESEL";

const normalizeFuelType = (value: string): FuelType | null => {
	const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
	return isFuelType(normalized) ? normalized : null;
};

const getProductFuelType = (product: Product): FuelType | null => {
	const configuredFuelType = product.fuel_type ? normalizeFuelType(product.fuel_type) : null;
	if (configuredFuelType) return configuredFuelType;

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
	if (/\bdyed\b/i.test(productText) && /\bdiesel\b/i.test(productText)) return "DYED_DIESEL";
	if (/\bdiesel\b/i.test(productText)) return "ROAD_DIESEL";
	if (/\bgas(?:oline)?\b/i.test(productText)) return "GASOLINE";
	return null;
};

const ticketLinesFor = (ticket: Ticket): TicketLine[] =>
	ticket.items?.length ? ticket.items : [ticket];

const ticketHasDyedProduct = (ticket: Ticket) =>
	ticketLinesFor(ticket).some((line) => /\bdyed\b/i.test(String(line.product_name ?? "")));

const dyedDieselWarning = "Dyed ULSD, 15 ppm sulfur. NOT for use in highway vehicles and engines.";

const ticketTotalGallons = (ticket: Ticket) =>
	ticketLinesFor(ticket).reduce((total, item) => total + (Number(item.quantity) || 0), 0);

const ticketSubtotal = (ticket: Ticket) =>
	ticketLinesFor(ticket).reduce((total, item) => total + (Number(item.extended_amount) || 0), 0);

const finiteAmount = (value: unknown): number | undefined => {
	if (value === null || value === undefined || value === "") return undefined;
	const amount = Number(value);
	return Number.isFinite(amount) ? amount : undefined;
};

const hasPriceChanged = (product: Product, draftPrice: string) => {
	if (draftPrice === "") return product.current_price !== null && product.current_price !== undefined;
	const draftAmount = Number(draftPrice);
	const currentAmount = product.current_price == null ? Number.NaN : Number(product.current_price);
	return !Number.isFinite(draftAmount) || !Number.isFinite(currentAmount) || draftAmount !== currentAmount;
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

// Display only: Net Due is the invoice amount before prompt pay discount.
const ticketDisplayNetDue = (ticket: Ticket) => ticketNetAmountDue(ticket) + ticketPromptPayDiscount(ticket);

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
	const [savingAllPrices, setSavingAllPrices] = useState(false);
	const [pricingError, setPricingError] = useState("");
	const [pricingMessage, setPricingMessage] = useState("");
	const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
	const [customers, setCustomers] = useState<Customer[]>([]);
	const [historyCustomers, setHistoryCustomers] = useState<Customer[]>([]);
	const [customerHistoryTickets, setCustomerHistoryTickets] = useState<Ticket[]>([]);
	const [search, setSearch] = useState("");
	const [customerSearch, setCustomerSearch] = useState("");
	const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
	const [isThreeInchTicketPrint, setIsThreeInchTicketPrint] = useState(false);
	const [ticketPdfError, setTicketPdfError] = useState("");
	const [selectedHistoryCustomerId, setSelectedHistoryCustomerId] = useState("");
	const [deliveryDateFilter, setDeliveryDateFilter] = useState<DeliveryDateFilter>("all");
	const [historyCustomersLoading, setHistoryCustomersLoading] = useState(false);
	const [customerTicketsLoading, setCustomerTicketsLoading] = useState(false);
	const [historyCustomersError, setHistoryCustomersError] = useState("");
	const [customerTicketsError, setCustomerTicketsError] = useState("");
	const [lineItemsWarning, setLineItemsWarning] = useState("");
	const [productLines, setProductLines] = useState<ProductLineDraft[]>([createProductLineDraft()]);
	const [selectedCustomerIndex, setSelectedCustomerIndex] = useState("");
	const [customerAutocompleteQuery, setCustomerAutocompleteQuery] = useState("");
	const [customerAutocompleteOpen, setCustomerAutocompleteOpen] = useState(false);
	const [highlightedCustomerIndex, setHighlightedCustomerIndex] = useState(0);
	const [driverNames, setDriverNames] = useState<string[]>([]);
	const [driverName, setDriverName] = useState("");
	const [deliveryDate, setDeliveryDate] = useState(getLocalDateInputValue);
	const [location, setLocation] = useState("South Dakota");
	const [nextTicketNumber, setNextTicketNumber] = useState<number | null>(null);
	const [ticketNumberLoading, setTicketNumberLoading] = useState(false);
	const [ticketNumberError, setTicketNumberError] = useState("");
	const [locationFuelTaxRates, setLocationFuelTaxRates] = useState<Partial<Record<FuelType, number>>>({});
	const [locationFuelTaxRatesLoading, setLocationFuelTaxRatesLoading] = useState(false);
	const [locationFuelTaxError, setLocationFuelTaxError] = useState("");
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
	const isLubeTicketPage = path === "/bulk-oil-lubricants";
	const isAdminPricingPage = path === "/admin/pricing";
	const selectedFuelTypesKey = productLines.flatMap((line) => {
		if (line.productIndex === "") return [];
		const product = products[Number(line.productIndex)];
		const fuelType = product ? getProductFuelType(product) : null;
		return fuelType ? [fuelType] : [];
	}).join(",");
	const selectedProductIndexesKey = productLines
		.flatMap((line) => line.productIndex === "" ? [] : [line.productIndex])
		.join(",");

	useEffect(() => {
		const updatePath = () => setPath(window.location.pathname);
		window.addEventListener("popstate", updatePath);
		return () => window.removeEventListener("popstate", updatePath);
	}, []);

	useEffect(() => {
		if (!isThreeInchTicketPrint) return;

		const finishPrint = () => setIsThreeInchTicketPrint(false);
		window.addEventListener("afterprint", finishPrint);
		window.print();
		return () => window.removeEventListener("afterprint", finishPrint);
	}, [isThreeInchTicketPrint]);

	useEffect(() => {
		if (!isCreateTicketPage && !isLubeTicketPage) return;

		let active = true;
		setTicketNumberLoading(true);
		setTicketNumberError("");
		const loadNextTicketNumber = async () => {
			try {
				const number = await fetchNextTicketNumber();
				if (active) setNextTicketNumber(number);
			} catch (loadError) {
				if (active) {
					setTicketNumberError(loadError instanceof Error ? loadError.message : "Unable to load the next ticket number.");
				}
			} finally {
				if (active) setTicketNumberLoading(false);
			}
		};

		void loadNextTicketNumber();
		return () => {
			active = false;
		};
	}, [isCreateTicketPage, isLubeTicketPage]);

	useEffect(() => {
		if (!isHistoryPage) return;

		const loadTickets = async () => {
			setLoading(true);
			setError("");
			try {
				const [ticketResult, customersForHistory] = await Promise.all([
					supabase
						.from("delivery_tickets")
						.select("*")
						.order("created_at", { ascending: false }),
					fetchAllCustomers(),
				]);

				if (ticketResult.error) {
					setError(ticketResult.error.message);
				} else {
					const customerById = new Map<string, Customer>();
					for (const customer of customersForHistory) {
						if (customer.id !== null && customer.id !== undefined) {
							customerById.set(String(customer.id), customer);
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
						return {
							...ticket,
							business_name: customer?.business_name ?? null,
							billing_address: customer?.billing_address ?? null,
							billing_city: customer?.city ?? null,
							billing_state: customer?.state ?? null,
							billing_zip: customer?.zip ?? null,
						};
					}));
				}
			} catch (loadError) {
				setError(loadError instanceof Error ? loadError.message : "Unable to load ticket history.");
			} finally {
				setLoading(false);
			}
		};

		void loadTickets();
	}, [isHistoryPage]);

	useEffect(() => {
		if (!isCustomerHistoryPage) return;

		const loadHistoryCustomers = async () => {
			setHistoryCustomersLoading(true);
			setHistoryCustomersError("");
			try {
				const loadedCustomers = await fetchAllCustomers();
				setHistoryCustomers(loadedCustomers.sort((a, b) =>
					(a.business_name ?? "").localeCompare(b.business_name ?? ""),
				));
			} catch (loadError) {
				setHistoryCustomersError(loadError instanceof Error ? loadError.message : "Unable to load customers.");
				setHistoryCustomers([]);
			} finally {
				setHistoryCustomersLoading(false);
			}
		};

		void loadHistoryCustomers();
	}, [isCustomerHistoryPage]);

	useEffect(() => {
		if (!isCustomerHistoryPage || !selectedHistoryCustomerId) return;

		let active = true;
		const loadCustomerTickets = async () => {
			const historyCustomer = historyCustomers.find(
				(customer) => String(customer.id ?? "") === selectedHistoryCustomerId,
			);
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
				setCustomerHistoryTickets(ticketsWithLines.map((ticket) => ({
					...ticket,
					business_name: historyCustomer?.business_name ?? null,
					billing_address: historyCustomer?.billing_address ?? null,
					billing_city: historyCustomer?.city ?? null,
					billing_state: historyCustomer?.state ?? null,
					billing_zip: historyCustomer?.zip ?? null,
				})));
			}
			setCustomerTicketsLoading(false);
		};

		void loadCustomerTickets();
		return () => {
			active = false;
		};
	}, [isCustomerHistoryPage, selectedHistoryCustomerId, historyCustomers]);

	useEffect(() => {
		if (!isCreateTicketPage && !isLubeTicketPage) return;

		let active = true;
		setReferencesLoading(true);
		setReferenceError("");
		setProducts([]);
		setCustomers([]);
		setDriverNames([]);
		setTaxCodes([]);

		const loadFormOptions = async () => {
			try {
				const [productsResult, driversResult, taxCodesResult] = await Promise.all([
					supabase.from("products").select("*").eq("product_type", isLubeTicketPage ? "LUBE" : "FUEL"),
					supabase.from("drivers").select("name").order("name", { ascending: true }),
					supabase.from("tax_codes").select("sales_tax_code, description, tax_rate, is_taxable"),
				]);
				if (!active) return;

				if (productsResult.error) {
					setReferenceError(`Products: ${productsResult.error.message}`);
				} else {
					setProducts((productsResult.data ?? []) as Product[]);
				}
				try {
					setCustomers(await fetchAllCustomers());
				} catch (customerError) {
					if (active) {
						setReferenceError((current) =>
							[current, `Customers: ${customerError instanceof Error ? customerError.message : "Unable to load customers."}`]
								.filter(Boolean).join(" "),
						);
					}
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
			} catch (loadError) {
				if (active) {
					setReferenceError(loadError instanceof Error ? loadError.message : "Unable to load ticket form options.");
				}
			} finally {
				if (active) setReferencesLoading(false);
			}
		};

		void loadFormOptions();
		return () => {
			active = false;
		};
	}, [isCreateTicketPage, isLubeTicketPage]);

	useEffect(() => {
		if (!isCreateTicketPage) return;

		let active = true;
		setLocationFuelTaxRates({});
		setLocationFuelTaxError("");
		const fuelTypes = [...new Set(selectedFuelTypesKey.split(",").filter(isFuelType))];
		if (fuelTypes.length === 0) {
			setLocationFuelTaxRatesLoading(false);
			return () => {
				active = false;
			};
		}

		setLocationFuelTaxRatesLoading(true);
		const loadLocationFuelTaxRates = async () => {
			try {
				const { data, error: queryError } = await supabase
					.from("location_fuel_tax_rates")
					.select("fuel_type, state_fuel_tax")
					.eq("location", location)
					.in("fuel_type", fuelTypes);
				if (!active) return;
				if (queryError) {
					setLocationFuelTaxError(`State fuel-tax rates could not be loaded: ${queryError.message}`);
					return;
				}

				const rates: Partial<Record<FuelType, number>> = {};
				for (const rate of (data ?? []) as LocationFuelTaxRate[]) {
					const fuelType = normalizeFuelType(rate.fuel_type);
					if (!fuelType) {
						setLocationFuelTaxError(`Unsupported fuel type configured for ${location}: ${rate.fuel_type}.`);
						return;
					}
					const amount = finiteAmount(rate.state_fuel_tax);
					if (amount === undefined || amount < 0) {
						setLocationFuelTaxError(`Invalid state fuel-tax rate configured for ${location} ${fuelType}.`);
						return;
					}
					rates[fuelType] = amount;
				}
				setLocationFuelTaxRates(rates);
				if (location !== "Other") {
					const missingFuelTypes = fuelTypes.filter((fuelType) => rates[fuelType] === undefined);
					if (missingFuelTypes.length > 0) {
						setLocationFuelTaxError(
							`No state fuel-tax rate is configured for ${location}: ${missingFuelTypes.join(", ")}.`,
						);
					}
				}
			} catch (queryError) {
				if (active) {
					setLocationFuelTaxError(
						`State fuel-tax rates could not be loaded: ${
							queryError instanceof Error ? queryError.message : "unknown error."
						}`,
					);
				}
			} finally {
				if (active) setLocationFuelTaxRatesLoading(false);
			}
		};

		void loadLocationFuelTaxRates();
		return () => {
			active = false;
		};
	}, [isCreateTicketPage, location, selectedFuelTypesKey, selectedProductIndexesKey]);

	useEffect(() => {
		if (!isAdminPricingPage) return;

		let active = true;
		const loadProducts = async () => {
			setPricingLoading(true);
			setPricingError("");
			setPricingMessage("");
			try {
				const { data, error: loadError } = await supabase.from("products").select("*").eq("product_type", "FUEL");
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

	const saveAllProductPrices = async () => {
		const validationErrors: string[] = [];
		const failedIndexes = new Set<number>();
		const productsToSave: Array<{
			product: Product;
			index: number;
			productName: string;
			numericPrice: number;
		}> = [];

		pricingProducts.forEach((product, index) => {
			const priceText = pricingDraftPrices[index] ?? "";
			if (!hasPriceChanged(product, priceText)) return;

			const productName = String(product.product_name ?? product.name ?? product.title ?? `Product ${index + 1}`);
			if (!/^(?:\d+(?:\.\d{1,4})?|\.\d{1,4})$/.test(priceText)) {
				validationErrors.push(`${productName}: enter a price with no more than four decimal places.`);
				failedIndexes.add(index);
				return;
			}
			const price = Number(priceText);
			if (!Number.isFinite(price) || price < 0) {
				validationErrors.push(`${productName}: enter a valid price greater than or equal to zero.`);
				failedIndexes.add(index);
				return;
			}
			if (product.id === null || product.id === undefined) {
				validationErrors.push(`${productName}: no product ID is available.`);
				failedIndexes.add(index);
				return;
			}

			productsToSave.push({
				product,
				index,
				productName,
				numericPrice: Number(price.toFixed(4)),
			});
		});

		if (productsToSave.length === 0) {
			setPricingError(validationErrors.join(" "));
			setPricingMessage("");
			return;
		}

		setSavingAllPrices(true);
		setPricingError("");
		setPricingMessage("");
		try {
			const saveResults = await Promise.all(productsToSave.map(async ({ product, index, productName, numericPrice }) => {
				try {
					const { data, error: saveError } = await supabase
						.from("products")
						.update({ current_price: numericPrice })
						.eq("id", product.id)
						.select("id, current_price")
						.single();
					if (saveError) {
						return {
							index,
							error: `${productName}: ${saveError.code === "PGRST116"
								? "no matching product was updated. Check the products UPDATE policy."
								: saveError.message}`,
						};
					}
					if (
						!data ||
						data.current_price === null ||
						data.current_price === undefined ||
						!Number.isFinite(Number(data.current_price)) ||
						Number(data.current_price) !== numericPrice
					) {
						return { index, error: `${productName}: the saved price could not be verified.` };
					}
					return { index, error: null };
				} catch (saveError) {
					return {
						index,
						error: `${productName}: ${saveError instanceof Error ? saveError.message : "unable to save price."}`,
					};
				}
			}));
			saveResults.forEach((result) => {
				if (result.error) failedIndexes.add(result.index);
			});

			let refreshError = "";
			try {
				const { data, error: loadError } = await supabase.from("products").select("*").eq("product_type", "FUEL");
				if (loadError) {
					refreshError = `Prices were submitted, but the product list could not be refreshed: ${loadError.message}`;
				} else {
					const loadedProducts = (data ?? []) as Product[];
					setPricingProducts(loadedProducts);
					setPricingDraftPrices(Object.fromEntries(
						loadedProducts.map((product, index) => {
							const previousIndex = pricingProducts.findIndex((previous) =>
								previous.id !== null && previous.id !== undefined && previous.id === product.id,
							);
							const draftIndex = previousIndex >= 0 ? previousIndex : index;
							const draftPrice = failedIndexes.has(draftIndex)
								? pricingDraftPrices[draftIndex] ?? ""
								: product.current_price == null || !Number.isFinite(Number(product.current_price))
									? ""
									: Number(product.current_price).toFixed(4);
							return [index, draftPrice];
						}),
					));
				}
			} catch (loadError) {
				refreshError = `Prices were submitted, but the product list could not be refreshed: ${
					loadError instanceof Error ? loadError.message : "unknown error."
				}`;
			}

			const errors = [
				...validationErrors,
				...saveResults.flatMap((result) => result.error ? [result.error] : []),
				...(refreshError ? [refreshError] : []),
			];
			if (errors.length > 0) {
				setPricingError(errors.join(" "));
			} else {
				setPricingMessage("Prices Saved Successfully");
			}
		} catch (saveError) {
			setPricingError(saveError instanceof Error ? saveError.message : "Unable to save product prices.");
		} finally {
			setSavingAllPrices(false);
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
	const hasUnsavedPricingChanges = pricingProducts.some((product, index) =>
		hasPriceChanged(product, pricingDraftPrices[index] ?? ""),
	);
	const filteredTickets = tickets.filter((ticket) =>
		`${ticket.ticket_number ?? ""} ${ticketLinesFor(ticket).map((item) => item.product_name ?? "").join(" ")}`
			.toLowerCase()
			.includes(normalizedSearch),
	);
	const normalizedCustomerSearch = customerSearch.trim().toLowerCase();
	const filteredHistoryCustomers = historyCustomers.filter((customer) =>
		(customer.business_name ?? "").toLowerCase().includes(normalizedCustomerSearch),
	);
	const selectedHistoryCustomer = historyCustomers.find(
		(customer) => String(customer.id ?? "") === selectedHistoryCustomerId,
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
		(total, ticket) => total + (ticket.ticket_type === "LUBE" ? 0 : ticketLinesFor(ticket).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)),
		0,
	);
	const customerHistoryRevenue = customerVisibleTickets.reduce(
		(total, ticket) => total + ticketLinesFor(ticket).reduce((sum, item) => sum + (Number(item.extended_amount) || 0), 0),
		0,
	);
	const customerLabel = (customer: Customer, index: number) =>
		String(customer.business_name ?? `Customer ${index + 1}`);
	const selectedCustomer = selectedCustomerIndex === ""
		? null
		: customers[Number(selectedCustomerIndex)] ?? null;
	const normalizedCustomerAutocompleteQuery = customerAutocompleteQuery.trim().toLowerCase();
	const customerAutocompleteResults = customers
		.map((customer, index) => ({ customer, index }))
		.filter(({ customer }) => !normalizedCustomerAutocompleteQuery || [
			customer.business_name,
			customer.nexgen_customer_id,
			customer.customer_number,
		].some((value) => String(value ?? "").toLowerCase().includes(normalizedCustomerAutocompleteQuery)))
		.slice(0, 20);
	const displayedCustomerAutocompleteValue = customerAutocompleteOpen || !selectedCustomer
		? customerAutocompleteQuery
		: customerLabel(selectedCustomer, Number(selectedCustomerIndex));
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
		const fuelType = product ? getProductFuelType(product) : null;
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
			fuelType,
			salesTaxCode,
			salesTaxTreatment: taxCode?.description?.trim() || salesTaxCode,
			federalFuelTax: finiteAmount(product?.federal_fuel_tax) ?? 0,
			stateFuelTax: fuelType ? locationFuelTaxRates[fuelType] ?? 0 : 0,
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
	const unclassifiedFuelProducts = preparedProductLines
		.filter((line) => line.product && !line.fuelType)
		.map((line) => line.productName || line.productCode || "Selected product");
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
	const ticketType = (ticket: Ticket) => ticket.ticket_type === "LUBE" ? "LUBE" : "FUEL";
	const isLubeTicket = (ticket: Ticket) => ticket.ticket_type === "LUBE";
	const ticketBusinessName = (ticket: Ticket) =>
		ticket.business_name ?? "—";
	const ticketBillingAddressLines = (ticket: Ticket): string[] => {
		const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
		const street = text(ticket.billing_address);
		const state = text(ticket.billing_state);
		const stateZip = [state, text(ticket.billing_zip)].filter(Boolean).join(" ");
		const cityLine = [text(ticket.billing_city), stateZip].filter(Boolean).join(", ");
		return [street, cityLine].filter(Boolean);
	};
	const downloadTicketPdf = async (ticket: Ticket) => {
		const isLubeTicket = ticket.ticket_type === "LUBE";
		const { jsPDF } = await import("jspdf");
		const logoResponse = await fetch(gerstnerOilLogoUrl);
		if (!logoResponse.ok) {
			throw new Error(`Unable to load Gerstner Oil logo (${logoResponse.status}).`);
		}
		const logoData = new Uint8Array(await logoResponse.arrayBuffer());
		const pdf = new jsPDF({ unit: "pt", format: "letter" });
		const pageWidth = pdf.internal.pageSize.getWidth();
		const pageHeight = pdf.internal.pageSize.getHeight();
		const margin = 44;
		const contentWidth = pageWidth - margin * 2;
		const ink: [number, number, number] = [30, 30, 30];
		const rule: [number, number, number] = [90, 90, 90];
		pdf.setDrawColor(...rule);
		pdf.setLineWidth(0.8);
		pdf.setTextColor(...ink);

		pdf.addImage(logoData, "PNG", margin, 28, 150, 59.375, "gerstner-oil-logo", "FAST");
		pdf.setFont("helvetica", "normal");
		pdf.setFontSize(9);
		let companyInfoY = 98;
		for (const infoLine of [companyInfo.address.trim(), companyCityLine, companyInfo.phone.trim() ? `Ph. ${companyInfo.phone.trim()}` : ""].filter(Boolean)) {
			pdf.text(infoLine, margin, companyInfoY);
			companyInfoY += 11;
		}
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(18);
		pdf.text(isLubeTicket ? "OIL TICKET" : "FUEL TICKET", pageWidth - margin, 48, { align: "right" });
		pdf.setFontSize(9);
		pdf.setFont("helvetica", "normal");
		pdf.text("TICKET NUMBER", pageWidth - margin, 68, { align: "right" });
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(16);
		pdf.setTextColor(176, 30, 30);
		pdf.text(formatDetail(ticket.ticket_number), pageWidth - margin, 88, { align: "right" });
		pdf.setTextColor(...ink);

		const drawLineField = (label: string, value: string, x: number, y: number, width: number) => {
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(8);
			pdf.text(label.toUpperCase(), x, y);
			const labelWidth = pdf.getTextWidth(label.toUpperCase()) + 6;
			pdf.setFont("helvetica", "normal");
			pdf.setFontSize(10.5);
			const valueLines = (value || "—").split("\n").map((line) => pdf.splitTextToSize(line, width - labelWidth)[0] ?? "");
			valueLines.forEach((line, lineIndex) => pdf.text(line, x + labelWidth, y - 1 + lineIndex * 12));
			pdf.setLineWidth(0.5);
			pdf.line(x + labelWidth - 2, y + 2 + (valueLines.length - 1) * 12, x + width, y + 2 + (valueLines.length - 1) * 12);
		};
		let y = 132;
		pdf.setLineWidth(1.2);
		pdf.line(margin, y - 8, pageWidth - margin, y - 8);
		const infoGap = 12;
		const customerBoxWidth = contentWidth * 0.6;
		const ticketBoxWidth = contentWidth - customerBoxWidth - infoGap;
		const ticketBoxX = margin + customerBoxWidth + infoGap;
		const infoBoxHeight = 84;
		const boxPadding = 8;
		const drawInfoBox = (title: string, x: number, width: number, fields: [string, string][]) => {
			pdf.setLineWidth(0.8);
			pdf.rect(x, y, width, infoBoxHeight);
			pdf.setFillColor(238, 238, 238);
			pdf.rect(x, y, width, 16, "FD");
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(8);
			pdf.text(title.toUpperCase(), x + boxPadding, y + 11);
			fields.forEach(([label, value], index) => {
				drawLineField(label, value, x + boxPadding, y + 34 + index * 21, width - boxPadding * 2);
			});
		};
		drawInfoBox("Customer", margin, customerBoxWidth, [
			["Sold To", ticketBusinessName(ticket)],
			["Address", ticketBillingAddressLines(ticket).join("\n") || "—"],
		]);
		drawInfoBox("Ticket", ticketBoxX, ticketBoxWidth, [
			["Ticket No.", formatDetail(ticket.ticket_number)],
			["Date", formatDeliveryDate(ticket.delivery_date)],
			["Driver", formatDetail(ticket.driver_name)],
		]);
		y += infoBoxHeight + 12;

		const ticketItems = ticketLinesFor(ticket);
		const columns: { label: string; width: number; align: "left" | "right" }[] = isLubeTicket
			? [
				{ label: "PRODUCT", width: 0.46, align: "left" },
				{ label: "QUAN.", width: 0.16, align: "right" },
				{ label: "UNIT PRICE", width: 0.18, align: "right" },
				{ label: "AMOUNT", width: 0.2, align: "right" },
			]
			: [
				{ label: "PRODUCT", width: 0.3, align: "left" },
				{ label: "GALLONS", width: 0.13, align: "right" },
				{ label: "STATE TAX", width: 0.13, align: "right" },
				{ label: "FED. TAX", width: 0.13, align: "right" },
				{ label: "UNIT PRICE", width: 0.14, align: "right" },
				{ label: "AMOUNT", width: 0.17, align: "right" },
			];
		const columnEdges = columns.reduce<number[]>((edges, column) => [...edges, edges[edges.length - 1] + column.width * contentWidth], [margin]);
		const rowHeight = 26;
		const drawGridHeader = () => {
			pdf.setFillColor(238, 238, 238);
			pdf.rect(margin, y, contentWidth, 20, "FD");
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(8);
			columns.forEach((column, index) => {
				pdf.text(column.label, column.align === "left" ? columnEdges[index] + 6 : columnEdges[index + 1] - 6, y + 13, { align: column.align });
			});
			y += 20;
		};
		const drawGridRow = (cells: string[], subtext = "") => {
			pdf.rect(margin, y, contentWidth, rowHeight);
			columnEdges.slice(1, -1).forEach((edge) => pdf.line(edge, y, edge, y + rowHeight));
			pdf.setFont("helvetica", "normal");
			pdf.setFontSize(10);
			cells.forEach((cell, index) => {
				const column = columns[index];
				const text = column.align === "left" ? pdf.splitTextToSize(cell, column.width * contentWidth - 12)[0] ?? "" : cell;
				pdf.text(text, column.align === "left" ? columnEdges[index] + 6 : columnEdges[index + 1] - 6, y + (subtext && index === 0 ? 11 : 17), { align: column.align });
			});
			if (subtext) {
				pdf.setFontSize(6.5);
				pdf.text(pdf.splitTextToSize(subtext, columns[0].width * contentWidth - 12)[0] ?? "", columnEdges[0] + 6, y + 21);
			}
			y += rowHeight;
		};
		const ensurePdfSpace = (height: number) => {
			if (y + height > pageHeight - margin) {
				pdf.addPage();
				y = margin;
				drawGridHeader();
			}
		};
		pdf.setLineWidth(0.8);
		drawGridHeader();
		for (const item of ticketItems) {
			ensurePdfSpace(rowHeight);
			const quantity = Number(item.quantity || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
			drawGridRow(
				isLubeTicket
					? [formatDetail(item.product_name), quantity, formatUnitPrice(item.sell_price), formatCurrency(item.extended_amount)]
					: [
						formatDetail(item.product_name),
						quantity,
						formatFourDecimalPrice(item.state_fuel_tax),
						formatFourDecimalPrice(item.federal_fuel_tax),
						formatUnitPrice(item.sell_price),
						formatCurrency(item.extended_amount),
					],
				`Code ${formatDetail(item.product_code)} · Tax ${formatDetail(item.sales_tax_treatment ?? item.sales_tax_code ?? ticket.sales_tax_code)}`,
			);
		}
		for (let blank = ticketItems.length; blank < 3; blank += 1) {
			ensurePdfSpace(rowHeight);
			drawGridRow(columns.map(() => ""));
		}

		const totals: [string, string][] = [
			[isLubeTicket ? "Total Quantity" : "Total Gallons", ticketItems.reduce((total, item) => total + (Number(item.quantity) || 0), 0).toLocaleString("en-US", { maximumFractionDigits: 2 })],
			["Taxable Subtotal", formatCurrency(ticketTaxableSubtotal(ticket))],
			["Sales Tax", formatCurrency(ticketSalesTaxTotal(ticket))],
			["Invoice Subtotal", formatCurrency(ticketInvoiceSubtotal(ticket))],
			...(isLubeTicket ? [] : [["Prompt Pay Discount", formatCurrency(ticketPromptPayDiscount(ticket))] as [string, string]]),
			["Net Due / Total", formatCurrency(ticketDisplayNetDue(ticket))],
			...(isLubeTicket ? [] : [["Prompt Pay Amount Due", formatCurrency(ticketNetAmountDue(ticket))] as [string, string]]),
		];
		const hasDyed = ticketHasDyedProduct(ticket);
		const totalsHeight = totals.length * 18;
		ensurePdfSpace(Math.max(totalsHeight, 70) + 70);
		const totalsWidth = 230;
		const totalsX = pageWidth - margin - totalsWidth;
		const totalsTop = y;
		pdf.setFontSize(9);
		totals.forEach(([label, value], index) => {
			const rowY = totalsTop + index * 18;
			const isNet = label.startsWith("Net Due");
			pdf.rect(totalsX, rowY, totalsWidth, 18);
			pdf.setFont("helvetica", isNet ? "bold" : "normal");
			pdf.text(label.toUpperCase(), totalsX + 6, rowY + 12);
			pdf.text(value, totalsX + totalsWidth - 6, rowY + 12, { align: "right" });
		});
		const noticeWidth = totalsX - margin - 16;
		let noticeY = totalsTop + 12;
		if (hasDyed) {
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(11);
			const warningLines = pdf.splitTextToSize(dyedDieselWarning, noticeWidth - 16);
			pdf.rect(margin, totalsTop, noticeWidth, warningLines.length * 14 + 14);
			pdf.text(warningLines, margin + 8, noticeY + 6);
			noticeY += warningLines.length * 14 + 22;
		}
		if (!isLubeTicket) {
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(8);
			pdf.text("Less 7¢ per gallon if paid within 10 days.", margin, Math.max(noticeY, totalsTop + 12));
		}
		y = totalsTop + Math.max(totalsHeight, 70) + 36;
		ensurePdfSpace(60);
		pdf.setFont("helvetica", "bold");
		pdf.setFontSize(8);
		const signatureWidth = (contentWidth - 40) / 2;
		pdf.setLineWidth(0.6);
		pdf.line(margin, y, margin + signatureWidth, y);
		pdf.text("DELIVERED BY", margin, y + 12);
		pdf.line(margin + signatureWidth + 40, y, pageWidth - margin, y);
		pdf.text("RECEIVED BY", margin + signatureWidth + 40, y + 12);
		const filename = String(ticket.ticket_number ?? "delivery-ticket").replace(/[^a-z0-9_-]/gi, "-");
		pdf.save(`${filename}.pdf`);
	};
	const createTicket = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (
			locationFuelTaxRatesLoading ||
			locationFuelTaxError ||
			unclassifiedFuelProducts.length > 0 ||
			!selectedCustomer ||
			!driverName ||
			!deliveryDate ||
			!hasValidProductLines ||
			!location.trim()
		) return;

		setSavingTicket(true);
		setFormError("");
		setFormMessage("");
		const firstLine = preparedProductLines[0];
		const promptPayDiscount = draftTotalGallons * 0.07;
		const discountedTotal = draftGrandTotal - promptPayDiscount;
		const netAmountDue = draftInvoiceSubtotal + draftSalesTaxTotal - promptPayDiscount;

		try {
			const ticketNumber = await fetchNextTicketNumber();
			setNextTicketNumber(ticketNumber);
			const { data: insertedTicket, error: insertError } = await supabase
				.from("delivery_tickets")
				.insert({
					ticket_number: ticketNumber,
					customer_id: selectedCustomer.id,
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
				federal_fuel_tax: line.federalFuelTax,
				state_fuel_tax: line.stateFuelTax,
			}));
			const { error: lineItemsError } = await supabase
				.from("delivery_ticket_items")
				.insert(lineItems);

			if (lineItemsError) {
				setFormError(`Ticket ${ticketNumber} was created, but its product lines could not be saved: ${lineItemsError.message}`);
				return;
			}

			setFormMessage(`Ticket ${ticketNumber} saved.`);
			setProductLines([createProductLineDraft()]);
			setSelectedCustomerIndex("");
			setCustomerAutocompleteQuery("");
			setCustomerAutocompleteOpen(false);
			setDriverName("");
			setDeliveryDate(getLocalDateInputValue());
			setLocation("South Dakota");
		} catch (submissionError) {
			setFormError(submissionError instanceof Error ? submissionError.message : "Unable to save ticket.");
		} finally {
			setSavingTicket(false);
			setTicketNumberLoading(true);
			try {
				setNextTicketNumber(await fetchNextTicketNumber());
				setTicketNumberError("");
			} catch (numberError) {
				setTicketNumberError(numberError instanceof Error ? numberError.message : "Unable to refresh the next ticket number.");
			} finally {
				setTicketNumberLoading(false);
			}
		}
	};

	return (
		<div className={`app-shell${isThreeInchTicketPrint ? " printing-thermal-receipt" : ""}`}>
			<header className="topbar">
				<a className="brand" href="/create-ticket" onClick={navigate} aria-label="Fuel ticket">
					<img className="brand-logo" src={gerstnerOilLogoSvgUrl} alt="Gerstner Oil Company" />
				</a>
				<nav className="main-nav" aria-label="Main navigation">
					<a
						href="/create-ticket"
						onClick={navigate}
						className={isCreateTicketPage ? "nav-link active" : "nav-link"}
					>
						Fuel Ticket
					</a>
					<a
						href="/bulk-oil-lubricants"
						onClick={navigate}
						className={isLubeTicketPage ? "nav-link active" : "nav-link"}
					>
						Oil Ticket
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
								<div className="ticket-history-list">
									{filteredTickets.map((ticket, index) => (
										<article className="ticket-history-card" key={`${ticket.ticket_number ?? "ticket"}-${ticket.created_at ?? index}`}>
											<header className="ticket-history-card-header">
												<div>
													<span className="ticket-history-number">Ticket {ticket.ticket_number ?? "—"}</span>
													<h3>{ticketBusinessName(ticket)}</h3>
												</div>
												<div className="ticket-history-actions">
													<span className={`ticket-type-badge ${ticketType(ticket).toLowerCase()}`}>{ticketType(ticket)}</span>
													<button className="view-button" type="button" onClick={() => setSelectedTicket(ticket)}>View ticket</button>
												</div>
											</header>
											<div className="ticket-history-meta">
												<span><small>Driver</small><strong>{formatDetail(ticket.driver_name)}</strong></span>
												<span><small>Delivery date</small><strong>{formatDeliveryDate(ticket.delivery_date)}</strong></span>
												<span><small>Created</small><strong>{formatDate(ticket.created_at)}</strong></span>
											</div>
											<div className="ticket-history-products">
												{ticketLinesFor(ticket).map((item, itemIndex) => (
													<div className="ticket-history-product" key={`${item.id ?? itemIndex}-${itemIndex}`}>
														<div className="ticket-history-product-heading">
															<strong>{item.product_name ?? "—"}</strong>
															<strong>{formatCurrency(item.extended_amount)}</strong>
														</div>
														<div className="ticket-history-product-details">
															<span>{Number(item.quantity || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}{ticketType(ticket) === "LUBE" ? " × " : " gal × "}{formatFourDecimalPrice(item.sell_price)}</span>
															<span>Tax treatment: {formatDetail(item.sales_tax_treatment ?? item.sales_tax_code)}</span>
															{ticketType(ticket) === "FUEL" && <>
																<span>Federal tax: {formatFourDecimalPrice(item.federal_fuel_tax)}/gal</span>
																<span>State tax: {formatFourDecimalPrice(item.state_fuel_tax)}/gal</span>
															</>}
														</div>
													</div>
												))}
											</div>
											<div className="ticket-history-totals">
												<span>Taxable subtotal<strong>{formatCurrency(ticketTaxableSubtotal(ticket))}</strong></span>
												<span>Sales tax<strong>{formatCurrency(ticketSalesTaxTotal(ticket))}</strong></span>
												<span>Invoice subtotal<strong>{formatCurrency(ticketInvoiceSubtotal(ticket))}</strong></span>
												{ticketType(ticket) === "FUEL" && <span>Prompt Pay Discount<strong>{formatCurrency(ticketPromptPayDiscount(ticket))}</strong></span>}
												<span className="ticket-history-net-due">Net due<strong>{formatCurrency(ticketDisplayNetDue(ticket))}</strong></span>
												{ticketType(ticket) === "FUEL" && <span className="ticket-history-net-due">Prompt Pay Amount Due<strong>{formatCurrency(ticketNetAmountDue(ticket))}</strong></span>}
											</div>
										</article>
									))}
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
										const customerId = customer.id;
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
										<span className="summary-note">Fuel tickets in selected date range</span>
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
														<th>Type</th>
														<th>Delivery date</th>
														<th>Driver name</th>
														<th>Product name</th>
														<th>Tax treatment</th>
														<th>Location</th>
														<th className="numeric-cell">Federal fuel tax / gal</th>
														<th className="numeric-cell">State fuel tax / gal</th>
														<th className="numeric-cell">Quantity</th>
														<th className="numeric-cell">Sell price</th>
														<th className="numeric-cell">Extended amount</th>
														<th className="numeric-cell">Taxable subtotal</th>
														<th className="numeric-cell">Sales tax</th>
														<th className="numeric-cell">Invoice subtotal</th>
														<th className="numeric-cell">Prompt Pay Discount</th>
														<th className="numeric-cell">Net due</th>
														<th className="numeric-cell">Prompt Pay Amount Due</th>
														<th><span className="sr-only">Actions</span></th>
													</tr>
												</thead>
												<tbody>
													{customerVisibleTickets.flatMap((ticket, index) => {
														const lines = ticketLinesFor(ticket);
														return lines.map((item, itemIndex) => (
															<tr key={`${ticket.ticket_number ?? "ticket"}-${ticket.created_at ?? index}-${item.id ?? itemIndex}`}>
																{itemIndex === 0 && <td className="ticket-number" rowSpan={lines.length}>{ticket.ticket_number ?? "—"}</td>}
																{itemIndex === 0 && <td rowSpan={lines.length}><span className={`ticket-type-badge ${ticketType(ticket).toLowerCase()}`}>{ticketType(ticket)}</span></td>}
																{itemIndex === 0 && <td className="date-cell" rowSpan={lines.length}>{ticket.delivery_date ? formatDeliveryDate(ticket.delivery_date) : formatDate(ticket.created_at)}</td>}
																{itemIndex === 0 && <td rowSpan={lines.length}>{formatDetail(ticket.driver_name)}</td>}
																<td className="product-cell">{item.product_name ?? "—"}</td>
																<td>{formatDetail(item.sales_tax_treatment ?? item.sales_tax_code)}</td>
																<td>{ticket.location ?? "—"}</td>
																<td className="numeric-cell">{ticketType(ticket) === "LUBE" ? "—" : formatFourDecimalPrice(item.federal_fuel_tax)}</td>
																<td className="numeric-cell">{ticketType(ticket) === "LUBE" ? "—" : formatFourDecimalPrice(item.state_fuel_tax)}</td>
																<td className="numeric-cell">{Number(item.quantity || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
																<td className="numeric-cell">{formatFourDecimalPrice(item.sell_price)}</td>
																<td className="numeric-cell amount-cell">{formatCurrency(item.extended_amount)}</td>
																{itemIndex === 0 && <td className="numeric-cell" rowSpan={lines.length}>{formatCurrency(ticketTaxableSubtotal(ticket))}</td>}
																{itemIndex === 0 && <td className="numeric-cell" rowSpan={lines.length}>{formatCurrency(ticketSalesTaxTotal(ticket))}</td>}
																{itemIndex === 0 && <td className="numeric-cell" rowSpan={lines.length}>{formatCurrency(ticketInvoiceSubtotal(ticket))}</td>}
																{itemIndex === 0 && <td className="numeric-cell" rowSpan={lines.length}>{ticketType(ticket) === "LUBE" ? "—" : formatCurrency(ticketPromptPayDiscount(ticket))}</td>}
																{itemIndex === 0 && <td className="numeric-cell amount-cell" rowSpan={lines.length}>{formatCurrency(ticketDisplayNetDue(ticket))}</td>}
																{itemIndex === 0 && <td className="numeric-cell amount-cell" rowSpan={lines.length}>{ticketType(ticket) === "LUBE" ? "—" : formatCurrency(ticketNetAmountDue(ticket))}</td>}
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
						<div>
							<button
								className="view-button"
								type="button"
								disabled={pricingLoading || savingAllPrices || savingPriceIndex !== null || !hasUnsavedPricingChanges}
								onClick={() => void saveAllProductPrices()}
							>
								{savingAllPrices ? "Saving..." : "Save All Changes"}
							</button>
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
												<tr
													className={hasPriceChanged(product, priceText) ? "pricing-row-modified" : undefined}
													key={String(product.id ?? product.product_code ?? index)}
												>
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
															disabled={savingAllPrices || savingPriceIndex !== null || !hasPriceChanged(product, priceText)}
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
							<div>
								<button
									className="view-button"
									type="button"
									disabled={pricingLoading || savingAllPrices || savingPriceIndex !== null || !hasUnsavedPricingChanges}
									onClick={() => void saveAllProductPrices()}
								>
									{savingAllPrices ? "Saving..." : "Save All Changes"}
								</button>
							</div>
						</section>
					</>
				) : isLubeTicketPage ? (
					<LubeTicketPage
						products={products}
						customers={customers}
						driverNames={driverNames}
						taxCodes={taxCodes}
						referencesLoading={referencesLoading}
						referenceError={referenceError}
						nextTicketNumber={nextTicketNumber}
						ticketNumberLoading={ticketNumberLoading}
						ticketNumberError={ticketNumberError}
						getNextTicketNumber={fetchNextTicketNumber}
						onTicketNumberUpdated={setNextTicketNumber}
						onNavigate={navigate}
					/>
				) : isCreateTicketPage ? (
					<>
						<div className="page-heading">
							<div>
								<p className="eyebrow">DELIVERY OPERATIONS / ENTRY</p>
								<h1>Fuel Ticket</h1>
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
								<section className="ticket-form-card ticket-information-card" aria-labelledby="ticket-information-heading">
									<div className="ticket-form-card-heading">
										<h3 id="ticket-information-heading">Ticket Information</h3>
										<p>Customer and delivery details</p>
									</div>
								<label className="form-field calculated-field">
									<span>Ticket number</span>
									<input
										readOnly
										value={ticketNumberLoading ? "Loading…" : nextTicketNumber?.toString() ?? ""}
										placeholder="Unable to load ticket number"
									/>
								</label>
								<div className="form-field customer-autocomplete-field">
									<label htmlFor="ticket-customer">Business name</label>
									<div className="customer-autocomplete">
										<input
											id="ticket-customer"
											type="text"
											role="combobox"
											autoComplete="off"
											aria-autocomplete="list"
											aria-expanded={customerAutocompleteOpen}
											aria-controls="ticket-customer-options"
											aria-activedescendant={
												customerAutocompleteOpen && customerAutocompleteResults[highlightedCustomerIndex]
													? `ticket-customer-option-${customerAutocompleteResults[highlightedCustomerIndex].index}`
													: undefined
											}
											aria-required="true"
											placeholder={referencesLoading ? "Loading customers…" : "Search by name or customer number"}
											value={displayedCustomerAutocompleteValue}
											onFocus={() => setCustomerAutocompleteOpen(true)}
											onChange={(event) => {
												setCustomerAutocompleteQuery(event.target.value);
												setSelectedCustomerIndex("");
												setHighlightedCustomerIndex(0);
												setCustomerAutocompleteOpen(true);
												setFormMessage("");
											}}
											onKeyDown={(event) => {
												if (event.key === "ArrowDown") {
													event.preventDefault();
													setCustomerAutocompleteOpen(true);
													setHighlightedCustomerIndex((current) =>
														Math.min(current + 1, Math.max(customerAutocompleteResults.length - 1, 0)),
													);
												} else if (event.key === "ArrowUp") {
													event.preventDefault();
													setCustomerAutocompleteOpen(true);
													setHighlightedCustomerIndex((current) => Math.max(current - 1, 0));
												} else if (event.key === "Enter" && customerAutocompleteOpen) {
													if (customerAutocompleteResults[highlightedCustomerIndex]) {
														event.preventDefault();
														const { customer, index } = customerAutocompleteResults[highlightedCustomerIndex];
														setSelectedCustomerIndex(String(index));
														setCustomerAutocompleteQuery(customerLabel(customer, index));
														setCustomerAutocompleteOpen(false);
													} else {
														event.preventDefault();
													}
												} else if (event.key === "Escape") {
													setCustomerAutocompleteOpen(false);
													setCustomerAutocompleteQuery(selectedCustomer
														? customerLabel(selectedCustomer, Number(selectedCustomerIndex))
														: customerAutocompleteQuery);
												}
											}}
											onBlur={() => setCustomerAutocompleteOpen(false)}
											disabled={referencesLoading || customers.length === 0}
										/>
										{customerAutocompleteOpen && (
											<div className="customer-autocomplete-options" id="ticket-customer-options" role="listbox">
												{customerAutocompleteResults.length > 0 ? customerAutocompleteResults.map(({ customer, index }, resultIndex) => (
													<button
														className={`customer-autocomplete-option${resultIndex === highlightedCustomerIndex ? " highlighted" : ""}`}
														id={`ticket-customer-option-${index}`}
														key={`${customer.id ?? index}-${index}`}
														type="button"
														role="option"
														aria-selected={resultIndex === highlightedCustomerIndex}
														onMouseDown={(event) => event.preventDefault()}
														onMouseEnter={() => setHighlightedCustomerIndex(resultIndex)}
														onClick={() => {
															setSelectedCustomerIndex(String(index));
															setCustomerAutocompleteQuery(customerLabel(customer, index));
															setCustomerAutocompleteOpen(false);
															setFormMessage("");
														}}
													>
														{customerLabel(customer, index)}
													</button>
												)) : (
													<div className="customer-autocomplete-empty" role="status">
														{referencesLoading ? "Loading customers…" : "No matching customers"}
													</div>
												)}
											</div>
										)}
									</div>
									{!selectedCustomer && customerAutocompleteQuery && (
										<span className="customer-autocomplete-hint">Select a customer from the results.</span>
									)}
								</div>
								<label className="form-field">
									<span>Location</span>
									<select
										required
										value={location}
										onChange={(event) => {
											setLocation(event.target.value);
											setLocationFuelTaxRates({});
											setLocationFuelTaxError("");
											setLocationFuelTaxRatesLoading(Boolean(selectedFuelTypesKey));
											setFormMessage("");
										}}
									>
										<option value="South Dakota">South Dakota</option>
										<option value="Nebraska">Nebraska</option>
										<option value="Other">Other</option>
									</select>
									{locationFuelTaxRatesLoading && <span>Loading state fuel-tax rates…</span>}
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
								</section>
								<section className="ticket-form-card product-lines-card" aria-labelledby="product-lines-heading">
								<div className="product-lines-field">
									<div className="product-lines-heading">
										<h3 id="product-lines-heading">Product Lines</h3>
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
															if (productIndex !== line.productIndex) {
																setLocationFuelTaxRates({});
																setLocationFuelTaxError("");
																setLocationFuelTaxRatesLoading(Boolean(product) || productLines.some((draft) =>
																	draft.id !== line.id && draft.productIndex !== "",
																));
															}
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
												<label className="form-field calculated-field">
													<span>Federal Fuel Tax Included</span>
													<input readOnly value={`${formatFourDecimalPrice(line.federalFuelTax)} per gallon`} />
												</label>
												<label className="form-field calculated-field">
													<span>State Fuel Tax Included</span>
													<input readOnly value={`${formatFourDecimalPrice(line.stateFuelTax)} per gallon`} />
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
								</div>
								</section>
								<section className="ticket-form-card pricing-totals-card" aria-labelledby="pricing-totals-heading">
									<div className="ticket-form-card-heading">
										<h3 id="pricing-totals-heading">Pricing &amp; Totals</h3>
										<p>Delivery cost summary</p>
									</div>
									<div className="product-lines-total">
										<span>Total gallons <strong>{draftTotalGallons.toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong></span>
										<span>Taxable subtotal <strong>{formatCurrency(draftTaxableSubtotal)}</strong></span>
										<span>Sales tax <strong>{formatCurrency(draftSalesTaxTotal)}</strong></span>
										<span>Invoice subtotal <strong>{formatCurrency(draftInvoiceSubtotal)}</strong></span>
										<span>Prompt Pay Discount (7¢/gal if paid within 10 days) <strong>{formatCurrency(draftPromptPayDiscount)}</strong></span>
										<span>Net due <strong>{formatCurrency(draftNetAmountDue + draftPromptPayDiscount)}</strong></span>
										<span>Prompt Pay Amount Due <strong>{formatCurrency(draftNetAmountDue)}</strong></span>
									</div>
								</section>
								{unconfiguredTaxCodes.length > 0 && (
									<p className="reference-error" role="alert">
										Configure tax code{unconfiguredTaxCodes.length === 1 ? "" : "s"} {unconfiguredTaxCodes.join(", ")} in the tax_codes table before saving.
									</p>
								)}
								{unclassifiedFuelProducts.length > 0 && (
									<p className="reference-error" role="alert">
										Configure a supported fuel_type for {unclassifiedFuelProducts.join(", ")} before saving.
									</p>
								)}
								{locationFuelTaxError && <p className="reference-error" role="alert">{locationFuelTaxError}</p>}
								<div className="ticket-form-footer">
									<div className="form-feedback" aria-live="polite">
										{formError && <span className="form-error" role="alert">{formError}</span>}
										{ticketNumberError && <span className="form-error" role="alert">{ticketNumberError}</span>}
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
										disabled={savingTicket || ticketNumberLoading || nextTicketNumber === null || Boolean(ticketNumberError) || referencesLoading || locationFuelTaxRatesLoading || Boolean(locationFuelTaxError) || unclassifiedFuelProducts.length > 0 || !hasValidProductLines || !selectedCustomer || !driverName || !deliveryDate || !location.trim()}
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
							<span className={`ticket-type-badge ${ticketType(selectedTicket).toLowerCase()}`}>{ticketType(selectedTicket)}</span>
							<button className="ticket-action-button" type="button" onClick={() => window.print()}>
								Print Ticket
							</button>
							<button className="ticket-action-button" type="button" onClick={() => setIsThreeInchTicketPrint(true)}>
								Print Receipt
							</button>
							<button
								className="ticket-action-button primary-action"
								type="button"
								onClick={() => {
									setTicketPdfError("");
									void downloadTicketPdf(selectedTicket).catch((pdfError: unknown) => {
										setTicketPdfError(pdfError instanceof Error ? pdfError.message : "Unable to create ticket PDF.");
									});
								}}
							>
								Download PDF
							</button>
							<button className="ticket-action-button close-action" type="button" onClick={() => setSelectedTicket(null)}>
								Close
							</button>
						</div>
						{ticketPdfError && <p className="ticket-pdf-error" role="alert">{ticketPdfError}</p>}
						<article className="ticket-print-content">
							<header className="ticket-paper-header">
								<div className="ticket-company">
									<img className="ticket-company-logo" src={gerstnerOilLogoSvgUrl} alt="Gerstner Oil Company" />
									<div>
										<strong>{companyInfo.companyName || "FUEL DESK"}</strong>
										{companyInfo.address && <span>{companyInfo.address}</span>}
										{companyCityLine && <span>{companyCityLine}</span>}
										{companyInfo.phone && <span>Phone: {companyInfo.phone}</span>}
									</div>
								</div>
								<div className="ticket-heading-meta">
									<h2 id="modal-title">{isLubeTicket(selectedTicket) ? "OIL TICKET" : "FUEL TICKET"}</h2>
									<span>Ticket Number</span>
									<strong>{formatDetail(selectedTicket.ticket_number)}</strong>
								</div>
							</header>
							<div className="ticket-paper-body">
								<section className="ticket-info-grid" aria-label="Ticket and customer information">
									<div className="ticket-info-box">
										<h3>Customer</h3>
										<div className="ticket-info-field">
											<span>Sold To</span>
											<strong>{ticketBusinessName(selectedTicket)}</strong>
										</div>
										<div className="ticket-info-field">
											<span>Address</span>
											<strong>
												{ticketBillingAddressLines(selectedTicket).length
													? ticketBillingAddressLines(selectedTicket).map((line) => <span className="ticket-address-line" key={line}>{line}</span>)
													: "—"}
											</strong>
										</div>
									</div>
									<div className="ticket-info-box">
										<h3>Ticket</h3>
										<div className="ticket-info-field">
											<span>Ticket No.</span>
											<strong>{formatDetail(selectedTicket.ticket_number)}</strong>
										</div>
										<div className="ticket-info-field">
											<span>Date</span>
											<strong>{formatDeliveryDate(selectedTicket.delivery_date)}</strong>
										</div>
										<div className="ticket-info-field">
											<span>Driver</span>
											<strong>{formatDetail(selectedTicket.driver_name)}</strong>
										</div>
									</div>
								</section>

								<section className="ticket-product-section" aria-label="Product information">
									<table className={`ticket-product-grid${isLubeTicket(selectedTicket) ? " lube-grid" : ""}`}>
										<thead>
											<tr>
												<th className="grid-product">Product</th>
												<th>{isLubeTicket(selectedTicket) ? "Quan." : "Gallons"}</th>
												{!isLubeTicket(selectedTicket) && <th>State Tax</th>}
												{!isLubeTicket(selectedTicket) && <th>Fed. Tax</th>}
												<th>Unit Price</th>
												<th>Amount</th>
											</tr>
										</thead>
										<tbody>
											{ticketLinesFor(selectedTicket).map((item, index) => (
												<tr key={`${item.id ?? index}-${index}`}>
													<td className="grid-product">
														{formatDetail(item.product_name)}
														<small>
															Code {formatDetail(item.product_code)} · Tax {formatDetail(item.sales_tax_treatment ?? item.sales_tax_code ?? selectedTicket.sales_tax_code)}
														</small>
													</td>
													<td>{Number(item.quantity || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
													{!isLubeTicket(selectedTicket) && <td>{formatFourDecimalPrice(item.state_fuel_tax)}</td>}
													{!isLubeTicket(selectedTicket) && <td>{formatFourDecimalPrice(item.federal_fuel_tax)}</td>}
													<td>{formatUnitPrice(item.sell_price)}</td>
													<td>{formatCurrency(item.extended_amount)}</td>
												</tr>
											))}
											{Array.from({ length: Math.max(0, 3 - ticketLinesFor(selectedTicket).length) }).map((_, index) => (
												<tr className="grid-blank-row" key={`blank-${index}`} aria-hidden="true">
													<td className="grid-product">&nbsp;</td>
													<td />
													{!isLubeTicket(selectedTicket) && <td />}
													{!isLubeTicket(selectedTicket) && <td />}
													<td />
													<td />
												</tr>
											))}
										</tbody>
									</table>
								</section>

								<section className="ticket-metrics" aria-label="Delivery amounts">
									<div className="ticket-metric">
										<span>{isLubeTicket(selectedTicket) ? "Total quantity" : "Total gallons"}</span>
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
									{!isLubeTicket(selectedTicket) && <div className="ticket-metric">
										<span>Prompt Pay Discount</span>
										<strong>{formatCurrency(ticketPromptPayDiscount(selectedTicket))}</strong>
									</div>}
									<div className="ticket-metric total-metric">
										<span>Net due</span>
										<strong>{formatCurrency(ticketDisplayNetDue(selectedTicket))}</strong>
									</div>
									{!isLubeTicket(selectedTicket) && <div className="ticket-metric total-metric">
										<span>Prompt Pay Amount Due</span>
										<strong>{formatCurrency(ticketNetAmountDue(selectedTicket))}</strong>
									</div>}
								</section>

								<section className="ticket-terms-row" aria-label="Terms and notices">
									{!isLubeTicket(selectedTicket) && <p className="ticket-payment-terms">Less 7¢ per gallon if paid within 10 days.</p>}
									{ticketHasDyedProduct(selectedTicket) && <p className="ticket-dyed-warning">{dyedDieselWarning}</p>}
								</section>

								<section className="ticket-signatures" aria-label="Signatures">
									<div><span>Delivered By</span></div>
									<div><span>Received By</span></div>
								</section>
							</div>
						</article>
						<article className="thermal-receipt" aria-label="Thermal delivery receipt">
							<header className="thermal-receipt-header">
								<img className="thermal-receipt-logo" src={gerstnerOilLogoUrl} alt="Gerstner Oil Company" />
								<strong>{companyInfo.companyName || "FUEL DESK"}</strong>
								{companyInfo.address && <span>{companyInfo.address}</span>}
								{companyCityLine && <span>{companyCityLine}</span>}
								{companyInfo.phone && <span>Phone: {companyInfo.phone}</span>}
								<strong className="thermal-receipt-title">DELIVERY RECEIPT</strong>
							</header>

							<section className="thermal-receipt-details" aria-label="Delivery details">
								<div><span>Ticket</span><strong>{formatDetail(selectedTicket.ticket_number)}</strong></div>
								<div><span>Ticket type</span><strong>{ticketType(selectedTicket)}</strong></div>
								<div><span>Customer</span><strong>{ticketBusinessName(selectedTicket)}</strong></div>
								<div><span>Driver</span><strong>{formatDetail(selectedTicket.driver_name)}</strong></div>
								<div><span>Delivery date</span><strong>{formatDeliveryDate(selectedTicket.delivery_date)}</strong></div>
								<div><span>Location</span><strong>{formatDetail(selectedTicket.location)}</strong></div>
							</section>

							<section className="thermal-receipt-products" aria-label="Product lines">
								<h3>PRODUCT LINES</h3>
								{ticketLinesFor(selectedTicket).map((item, index) => (
									<div className="thermal-receipt-product" key={`${item.id ?? index}-${index}`}>
										<strong className="thermal-receipt-product-name">
											{index + 1}. {formatDetail(item.product_name)}
										</strong>
										<div className="thermal-receipt-row">
											<span>{Number(item.quantity || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}{isLubeTicket(selectedTicket) ? " × " : " gal × "}{formatUnitPrice(item.sell_price)}</span>
											<strong>{formatCurrency(item.extended_amount)}</strong>
										</div>
										{!isLubeTicket(selectedTicket) && <div className="thermal-receipt-disclosure">
											<span>Federal fuel tax included</span>
											<strong>{formatFourDecimalPrice(item.federal_fuel_tax)}/gal</strong>
										</div>}
										{!isLubeTicket(selectedTicket) && <div className="thermal-receipt-disclosure">
											<span>State fuel tax included</span>
											<strong>{formatFourDecimalPrice(item.state_fuel_tax)}/gal</strong>
										</div>}
										<div className="thermal-receipt-disclosure">
											<span>Sales tax</span>
											<strong>{formatCurrency(item.sales_tax_amount)}</strong>
										</div>
									</div>
								))}
							</section>

							<section className="thermal-receipt-totals" aria-label="Receipt totals">
								<div><span>Sales tax</span><strong>{formatCurrency(ticketSalesTaxTotal(selectedTicket))}</strong></div>
								{!isLubeTicket(selectedTicket) && <div><span>Discount</span><strong>{formatCurrency(ticketPromptPayDiscount(selectedTicket))}</strong></div>}
								<div className="thermal-receipt-net"><span>Net due</span><strong>{formatCurrency(ticketDisplayNetDue(selectedTicket))}</strong></div>
								{!isLubeTicket(selectedTicket) && <div className="thermal-receipt-net"><span>Prompt Pay Amount Due</span><strong>{formatCurrency(ticketNetAmountDue(selectedTicket))}</strong></div>}
							</section>
							<footer className="thermal-receipt-footer">Thank you for your business.</footer>
						</article>
					</section>
				</div>
			)}
		</div>
	);
}

export default App;
