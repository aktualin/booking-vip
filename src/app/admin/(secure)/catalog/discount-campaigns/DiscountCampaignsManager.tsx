"use client";

import { useCallback } from "react";
import {
  deleteCampaign,
  listCampaignsPaged,
  type CampaignRow,
} from "@/app/actions/promo";
import type { AdminListParams } from "@/types/admin-pagination";
import EntityManager from "@/components/admin/EntityManager";
import { adminClass } from "@/components/admin/tokens";
import { useAdminPagedList } from "@/components/admin/useAdminList";
import { useLocale } from "@/components/providers/LocaleProvider";

/**
 * Stacked discount campaigns ("diskon akumulasi").
 *
 * The percent column is the **averaged** discount of the member products,
 * recomputed by the server on every read — 50% + 60% shows 55%, never 110%.
 */
export default function DiscountCampaignsManager() {
  const { t } = useLocale();
  const load = useCallback((params: AdminListParams) => listCampaignsPaged(params), []);
  const {
    rows,
    total,
    page,
    pageSize,
    searchInput,
    sort,
    loading,
    error,
    reload,
    setPage,
    setPageSize,
    setSearchInput,
    toggleSort,
  } = useAdminPagedList<CampaignRow>(load);

  const columns = [
    {
      key: "name",
      header: t("admin.campaigns.name"),
      sortable: true,
      render: (row: CampaignRow) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: "lineLabel",
      header: t("admin.campaigns.line"),
      sortable: true,
      render: (row: CampaignRow) => <span>{row.lineLabel}</span>,
    },
    {
      key: "memberCount",
      header: t("admin.campaigns.memberCount"),
      className: "text-right",
      sortable: true,
      render: (row: CampaignRow) => (
        <span className="tabular-nums text-[var(--admin-muted)]">{row.memberCount}</span>
      ),
    },
    {
      key: "percent",
      header: t("admin.campaigns.percent"),
      className: "text-right",
      sortable: true,
      render: (row: CampaignRow) => (
        <span className="tabular-nums font-medium">{row.percent}%</span>
      ),
    },
    {
      key: "active",
      header: t("admin.campaigns.status"),
      className: "text-right",
      sortable: true,
      render: (row: CampaignRow) => (
        <span className={`${adminClass.pill} ${row.active ? adminClass.pillOn : adminClass.pillOff}`}>
          {row.active ? t("admin.campaigns.on") : t("admin.campaigns.off")}
        </span>
      ),
    },
  ];

  return (
    <div>
      {error ? (
        <p className={`${adminClass.panel} mb-4 px-3 py-2 text-[12px] text-danger`}>{error}</p>
      ) : null}
      <EntityManager
        rows={rows}
        columns={columns}
        getKey={(row) => row.key}
        createHref="/admin/catalog/discount-campaigns/new"
        editHref={(row) => `/admin/catalog/discount-campaigns/${row.key}`}
        nameOf={(row) => row.name}
        itemLabel={t("admin.campaigns.itemLabel")}
        onDelete={async (row, typedName) => {
          const result = await deleteCampaign({
            key: row.key,
            confirmName: typedName,
          });
          if (result.ok) reload();
          return result;
        }}
        createLabel={t("admin.campaigns.create")}
        editLabel={t("admin.campaigns.edit")}
        emptyTitle={t("admin.campaigns.emptyTitle")}
        emptyDescription={t("admin.campaigns.emptyDescription")}
        loading={loading}
        search={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Cari kampanye…"
        sort={sort}
        onSortToggle={toggleSort}
        pagination={{
          page,
          pageSize,
          total,
          onPageChange: setPage,
          onPageSizeChange: setPageSize,
          itemLabel: "kampanye",
        }}
      />
    </div>
  );
}