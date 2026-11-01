--
-- PostgreSQL database dump
--

\restrict MlobvVPrzeP2bN2AqxjgTMf6CbRbBnZIoaUrlThPtrMvWQFrSNmNDvpC0W2BB6B

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.achievements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid,
    title character varying(255) NOT NULL,
    description text,
    date_earned date DEFAULT CURRENT_DATE NOT NULL,
    badge_icon character varying(100),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ai_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    feature character varying(100) NOT NULL,
    input_data jsonb,
    output_data jsonb,
    model_used character varying(100),
    tokens_used integer,
    latency_ms integer,
    triggered_by uuid,
    member_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid,
    member_id uuid,
    check_in timestamp with time zone,
    check_out timestamp with time zone,
    check_in_method character varying(30) DEFAULT 'manual'::character varying,
    marked_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    attendance_date date DEFAULT CURRENT_DATE NOT NULL,
    status smallint DEFAULT 1 NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action character varying(100) NOT NULL,
    table_name character varying(100) NOT NULL,
    record_id uuid,
    old_values jsonb,
    new_values jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: billing_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    price_monthly numeric(10,2),
    price_yearly numeric(10,2),
    max_branches integer,
    max_members integer,
    features jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid,
    manager_id uuid,
    name character varying(200) NOT NULL,
    address text,
    city character varying(100),
    phone character varying(20),
    email character varying(255),
    opening_time time without time zone,
    closing_time time without time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid,
    code character varying(50) NOT NULL,
    discount_type character varying(20) NOT NULL,
    discount_value numeric(10,2) NOT NULL,
    max_uses integer,
    used_count integer DEFAULT 0,
    valid_from timestamp with time zone,
    valid_until timestamp with time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: diet_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.diet_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid,
    trainer_id uuid,
    title character varying(150),
    goal character varying(100),
    plan_details jsonb,
    ai_generated boolean DEFAULT false,
    valid_from date,
    valid_until date,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: equipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid,
    name character varying(150) NOT NULL,
    category character varying(100),
    brand character varying(100),
    model_number character varying(100),
    purchase_date date,
    purchase_price numeric(10,2),
    warranty_until date,
    status character varying(30) DEFAULT 'active'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid,
    category character varying(100),
    amount numeric(10,2) NOT NULL,
    description text,
    expense_date date NOT NULL,
    receipt_url text,
    added_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: gym_module_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_module_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid,
    module_id character varying(100) NOT NULL,
    module_name character varying(150) NOT NULL,
    category character varying(100) DEFAULT 'MODULE SETTINGS'::character varying,
    path character varying(100),
    is_enabled boolean DEFAULT true NOT NULL,
    plan_tier character varying(50) DEFAULT 'Starter'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: gym_role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_role_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid,
    role_id character varying(100) NOT NULL,
    permission_key character varying(100) NOT NULL,
    is_allowed boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: gyms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gyms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid,
    name character varying(200) NOT NULL,
    logo_url text,
    address text,
    city character varying(100),
    state character varying(100),
    country character varying(100) DEFAULT 'India'::character varying,
    pincode character varying(10),
    phone character varying(20),
    email character varying(255),
    gstin character varying(20),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    billing_plan_id uuid
);


--
-- Name: invoice_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_sequences (
    gym_id uuid NOT NULL,
    year_month character varying(6) NOT NULL,
    last_seq integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid,
    member_id uuid,
    invoice_number character varying(100) NOT NULL,
    issued_date date DEFAULT CURRENT_DATE,
    due_date date,
    subtotal numeric(10,2),
    gst_rate numeric(5,2) DEFAULT 18.00,
    gst_amount numeric(10,2),
    total numeric(10,2),
    status character varying(30) DEFAULT 'paid'::character varying,
    pdf_url text,
    created_at timestamp with time zone DEFAULT now(),
    gym_id uuid,
    branch_id uuid,
    plan_name character varying(150),
    amount numeric(10,2),
    payment_mode character varying(50),
    issued_at timestamp with time zone DEFAULT now()
);


--
-- Name: lead_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_interactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid,
    interaction_type character varying(50),
    notes text,
    done_by uuid,
    interaction_date timestamp with time zone DEFAULT now()
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid,
    full_name character varying(150) NOT NULL,
    email character varying(255),
    phone character varying(20),
    source character varying(100),
    interest_in character varying(150),
    status character varying(50) DEFAULT 'new'::character varying,
    assigned_to uuid,
    ai_score numeric(5,2),
    notes text,
    follow_up_date date,
    converted_member_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: maintenance_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    equipment_id uuid,
    maintenance_type character varying(100),
    description text,
    cost numeric(10,2),
    serviced_by character varying(150),
    service_date date NOT NULL,
    next_service_date date,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: member_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid,
    doc_type character varying(100) NOT NULL,
    file_url text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now()
);


--
-- Name: member_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid,
    plan_id uuid,
    coupon_id uuid,
    start_date date NOT NULL,
    end_date date NOT NULL,
    freeze_start date,
    freeze_end date,
    status character varying(30) DEFAULT 'active'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    gym_id uuid,
    branch_id uuid
);


--
-- Name: members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid,
    user_id uuid,
    referred_by uuid,
    full_name character varying(150) NOT NULL,
    email character varying(255),
    phone character varying(20) NOT NULL,
    date_of_birth date,
    gender character varying(20),
    address text,
    profile_photo_url text,
    emergency_contact_name character varying(150),
    emergency_contact_phone character varying(20),
    health_notes text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    join_date date
);


--
-- Name: membership_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid,
    name character varying(150) NOT NULL,
    description text,
    duration_days integer NOT NULL,
    price numeric(10,2) NOT NULL,
    max_freeze_days integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    freeze_fee numeric(10,2) DEFAULT 0.00
);


--
-- Name: menu_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.menu_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type character varying(50) NOT NULL,
    path character varying(255),
    icon character varying(50),
    text character varying(100) NOT NULL,
    plan character varying(50),
    required_role character varying(50),
    sort_order integer DEFAULT 0 NOT NULL,
    is_placeholder boolean DEFAULT false NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid,
    branch_id uuid,
    title character varying(255) NOT NULL,
    content text NOT NULL,
    category character varying(100) DEFAULT 'Closure / Holiday'::character varying,
    priority character varying(50) DEFAULT 'Normal'::character varying,
    start_date date DEFAULT CURRENT_DATE,
    end_date date,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_sent_at timestamp with time zone,
    sent_count integer DEFAULT 0
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid,
    user_id uuid,
    member_id uuid,
    type character varying(100) NOT NULL,
    channel character varying(30) NOT NULL,
    title character varying(255),
    body text,
    status character varying(30) DEFAULT 'pending'::character varying,
    scheduled_at timestamp with time zone,
    sent_at timestamp with time zone,
    ai_generated boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid,
    membership_id uuid,
    branch_id uuid,
    amount numeric(10,2) NOT NULL,
    payment_mode character varying(50),
    payment_ref character varying(255),
    payment_date timestamp with time zone DEFAULT now(),
    status character varying(30) DEFAULT 'completed'::character varying,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    gym_id uuid
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    module character varying(100) NOT NULL,
    action character varying(50) NOT NULL,
    description text
);


--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid,
    name character varying(255) NOT NULL,
    description text,
    duration_months integer NOT NULL,
    price numeric(10,2) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    member_id uuid,
    device_token text NOT NULL,
    platform character varying(20),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: referrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referrals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referrer_id uuid,
    referred_id uuid,
    reward_given boolean DEFAULT false,
    reward_amount numeric(10,2),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid,
    member_id uuid,
    amount numeric(10,2) NOT NULL,
    reason text,
    refund_mode character varying(50),
    refund_ref character varying(255),
    refunded_by uuid,
    refunded_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid,
    member_id uuid,
    trainer_id uuid,
    rating integer,
    review_text text,
    is_public boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: role_menu_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_menu_items (
    role_id uuid NOT NULL,
    menu_item_id uuid NOT NULL
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(50) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    is_accountant boolean DEFAULT false,
    is_default boolean DEFAULT false
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid,
    key character varying(150) NOT NULL,
    value text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid,
    user_id uuid,
    role_id uuid,
    full_name character varying(150) NOT NULL,
    email character varying(255),
    phone character varying(20),
    designation character varying(100),
    salary numeric(10,2),
    joining_date date,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: staff_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid,
    branch_id uuid,
    check_in timestamp with time zone NOT NULL,
    check_out timestamp with time zone,
    marked_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid,
    billing_plan_id uuid,
    status character varying(30) DEFAULT 'active'::character varying,
    trial_ends_at timestamp with time zone,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_id uuid,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    full_name character varying(150) NOT NULL,
    phone character varying(20),
    is_active boolean DEFAULT true,
    refresh_token text,
    last_login timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    gym_id uuid,
    branch_id uuid
);


--
-- Name: workout_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workout_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid,
    trainer_id uuid,
    title character varying(150),
    goal character varying(100),
    plan_details jsonb,
    ai_generated boolean DEFAULT false,
    valid_from date,
    valid_until date,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: achievements achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT achievements_pkey PRIMARY KEY (id);


--
-- Name: ai_logs ai_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_logs
    ADD CONSTRAINT ai_logs_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: billing_plans billing_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_plans
    ADD CONSTRAINT billing_plans_pkey PRIMARY KEY (id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: coupons coupons_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_code_key UNIQUE (code);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: diet_plans diet_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diet_plans
    ADD CONSTRAINT diet_plans_pkey PRIMARY KEY (id);


--
-- Name: equipment equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: gym_module_configs gym_module_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_module_configs
    ADD CONSTRAINT gym_module_configs_pkey PRIMARY KEY (id);


--
-- Name: gym_role_permissions gym_role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_role_permissions
    ADD CONSTRAINT gym_role_permissions_pkey PRIMARY KEY (id);


--
-- Name: gyms gyms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gyms
    ADD CONSTRAINT gyms_pkey PRIMARY KEY (id);


--
-- Name: invoice_sequences invoice_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_sequences
    ADD CONSTRAINT invoice_sequences_pkey PRIMARY KEY (gym_id, year_month);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: lead_interactions lead_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_interactions
    ADD CONSTRAINT lead_interactions_pkey PRIMARY KEY (id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: maintenance_logs maintenance_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_logs
    ADD CONSTRAINT maintenance_logs_pkey PRIMARY KEY (id);


--
-- Name: member_documents member_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_documents
    ADD CONSTRAINT member_documents_pkey PRIMARY KEY (id);


--
-- Name: member_memberships member_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_memberships
    ADD CONSTRAINT member_memberships_pkey PRIMARY KEY (id);


--
-- Name: members members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_pkey PRIMARY KEY (id);


--
-- Name: membership_plans membership_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_plans
    ADD CONSTRAINT membership_plans_pkey PRIMARY KEY (id);


--
-- Name: menu_items menu_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_module_action_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_module_action_key UNIQUE (module, action);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: push_tokens push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (id);


--
-- Name: referrals referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: role_menu_items role_menu_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_menu_items
    ADD CONSTRAINT role_menu_items_pkey PRIMARY KEY (role_id, menu_item_id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: settings settings_gym_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_gym_id_key_key UNIQUE (gym_id, key);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: staff_attendance staff_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_attendance
    ADD CONSTRAINT staff_attendance_pkey PRIMARY KEY (id);


--
-- Name: staff staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: invoices uq_invoices_gym_invoice_number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT uq_invoices_gym_invoice_number UNIQUE (gym_id, invoice_number);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: workout_plans workout_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_plans
    ADD CONSTRAINT workout_plans_pkey PRIMARY KEY (id);


--
-- Name: idx_ai_logs_feature; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_logs_feature ON public.ai_logs USING btree (feature);


--
-- Name: idx_attendance_branch_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_branch_date ON public.attendance USING btree (branch_id, attendance_date);


--
-- Name: idx_attendance_checkin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_checkin ON public.attendance USING btree (check_in);


--
-- Name: idx_attendance_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_member ON public.attendance USING btree (member_id);


--
-- Name: idx_audit_logs_table; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_table ON public.audit_logs USING btree (table_name, record_id);


--
-- Name: idx_invoices_branch_issued; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_branch_issued ON public.invoices USING btree (branch_id, issued_at DESC);


--
-- Name: idx_invoices_gym_issued; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_gym_issued ON public.invoices USING btree (gym_id, issued_at DESC);


--
-- Name: idx_invoices_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_member ON public.invoices USING btree (member_id);


--
-- Name: idx_leads_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_branch ON public.leads USING btree (branch_id);


--
-- Name: idx_leads_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_status ON public.leads USING btree (status);


--
-- Name: idx_member_memberships_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_memberships_member ON public.member_memberships USING btree (member_id);


--
-- Name: idx_member_memberships_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_memberships_status ON public.member_memberships USING btree (status);


--
-- Name: idx_members_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_branch ON public.members USING btree (branch_id);


--
-- Name: idx_messages_gym_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_gym_branch ON public.messages USING btree (gym_id, branch_id);


--
-- Name: idx_messages_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_is_active ON public.messages USING btree (is_active);


--
-- Name: idx_notifications_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_status ON public.notifications USING btree (status);


--
-- Name: idx_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id);


--
-- Name: idx_payments_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_date ON public.payments USING btree (payment_date);


--
-- Name: idx_payments_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_member ON public.payments USING btree (member_id);


--
-- Name: uq_attendance_member_date; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_attendance_member_date ON public.attendance USING btree (member_id, attendance_date);


--
-- Name: uq_gym_module_configs; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_gym_module_configs ON public.gym_module_configs USING btree (COALESCE(gym_id, '00000000-0000-0000-0000-000000000000'::uuid), module_id);


--
-- Name: uq_gym_role_permissions; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_gym_role_permissions ON public.gym_role_permissions USING btree (COALESCE(gym_id, '00000000-0000-0000-0000-000000000000'::uuid), role_id, permission_key);


--
-- Name: uq_invoices_payment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_invoices_payment_id ON public.invoices USING btree (payment_id) WHERE (payment_id IS NOT NULL);


--
-- Name: achievements achievements_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT achievements_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: ai_logs ai_logs_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_logs
    ADD CONSTRAINT ai_logs_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id);


--
-- Name: ai_logs ai_logs_triggered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_logs
    ADD CONSTRAINT ai_logs_triggered_by_fkey FOREIGN KEY (triggered_by) REFERENCES public.users(id);


--
-- Name: attendance attendance_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: attendance attendance_marked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES public.users(id);


--
-- Name: attendance attendance_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id);


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: branches branches_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: branches branches_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.users(id);


--
-- Name: coupons coupons_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id);


--
-- Name: diet_plans diet_plans_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diet_plans
    ADD CONSTRAINT diet_plans_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: diet_plans diet_plans_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diet_plans
    ADD CONSTRAINT diet_plans_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.staff(id);


--
-- Name: equipment equipment_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: expenses expenses_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id);


--
-- Name: expenses expenses_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: gym_module_configs gym_module_configs_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_module_configs
    ADD CONSTRAINT gym_module_configs_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: gym_role_permissions gym_role_permissions_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_role_permissions
    ADD CONSTRAINT gym_role_permissions_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: gyms gyms_billing_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gyms
    ADD CONSTRAINT gyms_billing_plan_id_fkey FOREIGN KEY (billing_plan_id) REFERENCES public.billing_plans(id);


--
-- Name: gyms gyms_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gyms
    ADD CONSTRAINT gyms_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: invoice_sequences invoice_sequences_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_sequences
    ADD CONSTRAINT invoice_sequences_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id);


--
-- Name: invoices invoices_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


--
-- Name: lead_interactions lead_interactions_done_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_interactions
    ADD CONSTRAINT lead_interactions_done_by_fkey FOREIGN KEY (done_by) REFERENCES public.users(id);


--
-- Name: lead_interactions lead_interactions_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_interactions
    ADD CONSTRAINT lead_interactions_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: leads leads_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: leads leads_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: leads leads_converted_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_converted_member_id_fkey FOREIGN KEY (converted_member_id) REFERENCES public.members(id);


--
-- Name: maintenance_logs maintenance_logs_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_logs
    ADD CONSTRAINT maintenance_logs_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment(id) ON DELETE CASCADE;


--
-- Name: member_documents member_documents_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_documents
    ADD CONSTRAINT member_documents_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_memberships member_memberships_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_memberships
    ADD CONSTRAINT member_memberships_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id);


--
-- Name: member_memberships member_memberships_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_memberships
    ADD CONSTRAINT member_memberships_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_memberships member_memberships_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_memberships
    ADD CONSTRAINT member_memberships_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.membership_plans(id);


--
-- Name: members members_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: members members_referred_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_referred_by_fkey FOREIGN KEY (referred_by) REFERENCES public.members(id);


--
-- Name: members members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: membership_plans membership_plans_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_plans
    ADD CONSTRAINT membership_plans_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: messages messages_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: messages messages_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: messages messages_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id);


--
-- Name: notifications notifications_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: payments payments_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: payments payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: payments payments_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id);


--
-- Name: payments payments_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES public.member_memberships(id);


--
-- Name: plans plans_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: push_tokens push_tokens_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: push_tokens push_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: referrals referrals_referred_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referred_id_fkey FOREIGN KEY (referred_id) REFERENCES public.members(id);


--
-- Name: referrals referrals_referrer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.members(id);


--
-- Name: refunds refunds_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id);


--
-- Name: refunds refunds_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


--
-- Name: refunds refunds_refunded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_refunded_by_fkey FOREIGN KEY (refunded_by) REFERENCES public.users(id);


--
-- Name: reviews reviews_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: reviews reviews_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id);


--
-- Name: reviews reviews_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.staff(id);


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: settings settings_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: staff_attendance staff_attendance_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_attendance
    ADD CONSTRAINT staff_attendance_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: staff_attendance staff_attendance_marked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_attendance
    ADD CONSTRAINT staff_attendance_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES public.users(id);


--
-- Name: staff_attendance staff_attendance_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_attendance
    ADD CONSTRAINT staff_attendance_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: staff staff_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: staff staff_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: staff staff_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: subscriptions subscriptions_billing_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_billing_plan_id_fkey FOREIGN KEY (billing_plan_id) REFERENCES public.billing_plans(id);


--
-- Name: subscriptions subscriptions_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: users users_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: workout_plans workout_plans_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_plans
    ADD CONSTRAINT workout_plans_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: workout_plans workout_plans_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_plans
    ADD CONSTRAINT workout_plans_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.staff(id);


--
-- PostgreSQL database dump complete
--

\unrestrict MlobvVPrzeP2bN2AqxjgTMf6CbRbBnZIoaUrlThPtrMvWQFrSNmNDvpC0W2BB6B

