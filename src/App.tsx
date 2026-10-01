import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import "./App.css";

type Ticket = {
	ticket_number?: string | number | null;
	product_name?: string | null;
	quantity?: number | string | null;
	sell_price?: number | string | null;
	extended_amount?: number | string | null;
	created_at?: string | null;
	[key: string]: unknown;
};

function App() {
	const [path, setPath] = useState(window.location.pathname);
	const [tickets, setTickets] = useState<Ticket[]>([]);
	const [search, setSearch] = useState("");
	const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const isHistoryPage = path === "/ticket-history";

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
			const { data, error: queryError } = await supabase
				.from("delivery_tickets")
				.select("*")
				.order("created_at", { ascending: false });

			if (queryError) {
				setError(queryError.message);
			} else {
				setTickets((data ?? []) as Ticket[]);
			}
			setLoading(false);
		};

		void loadTickets();
	}, [isHistoryPage]);

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

	const formatCurrency = (value: unknown) =>
		new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
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

	return (
		<div className="app-shell">
			<header className="topbar">
				<a className="brand" href="/" onClick={navigate} aria-label="Fuel desk home">
					<span className="brand-mark">F</span>
					<span>Fuel desk</span>
				</a>
				<nav className="main-nav" aria-label="Main navigation">
					<a
						href="/"
						onClick={navigate}
						className={!isHistoryPage ? "nav-link active" : "nav-link"}
					>
						Overview
					</a>
					<a
						href="/ticket-history"
						onClick={navigate}
						className={isHistoryPage ? "nav-link active" : "nav-link"}
					>
						Ticket History
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
						<div className="modal-heading">
							<div>
								<p className="eyebrow">DELIVERY RECORD</p>
								<h2 id="modal-title">Ticket {selectedTicket.ticket_number ?? "details"}</h2>
							</div>
							<button
								className="modal-close"
								type="button"
								aria-label="Close ticket details"
								onClick={() => setSelectedTicket(null)}
							>
								×
							</button>
						</div>
						<dl className="detail-list">
							{Object.entries(selectedTicket).map(([key, value]) => (
								<div className="detail-row" key={key}>
									<dt>{key.replaceAll("_", " ")}</dt>
									<dd>{formatDetail(key === "created_at" ? formatDate(value) : value)}</dd>
								</div>
							))}
						</dl>
					</section>
				</div>
			)}
		</div>
	);
}

export default App;