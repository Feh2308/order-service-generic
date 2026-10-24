function dateOnly(value, raw = "") {
  if (raw) return raw;
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function timeOnly(value, raw = "") {
  if (raw) return raw;
  return value ? String(value).slice(0, 5) : "";
}

function mapEmployee(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    contact: row.contact,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapLocation(row) {
  if (!row) return null;
  return {
    type: row.type,
    label: row.label,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracy: row.accuracy,
    mapsUrl: row.maps_url,
    capturedAt: row.captured_at
  };
}

async function mapMedia(row, mediaUrlResolver) {
  if (!row) return null;
  const imageUrl = mediaUrlResolver ? await mediaUrlResolver(row) : null;
  return {
    stage: row.kind === "photo_before" ? "before" : row.kind === "photo_after" ? "after" : undefined,
    label: row.label,
    imageUrl,
    imageDataUrl: imageUrl,
    capturedAt: row.captured_at,
    capturedBy: row.captured_by,
    fileName: row.original_file_name,
    storageObjectId: row.storage_object_id
  };
}

class ServiceMapper {
  constructor({ mediaUrlResolver } = {}) {
    this.mediaUrlResolver = mediaUrlResolver;
  }

  async toPublicService(bundle) {
    const service = bundle.service;
    const before = bundle.media?.find((item) => item.kind === "photo_before");
    const after = bundle.media?.find((item) => item.kind === "photo_after");
    const signatureMedia = bundle.media?.find((item) => item.kind === "signature");
    const signatureUrl = signatureMedia
      ? await mapMedia(signatureMedia, this.mediaUrlResolver)
      : null;

    return {
      id: service.id,
      code: service.code,
      title: service.title,
      clientId: service.client_id,
      teamId: service.team_id,
      customer: service.customer_snapshot,
      date: dateOnly(service.scheduled_date, service.scheduled_date_raw),
      time: timeOnly(service.scheduled_time, service.scheduled_time_raw),
      location: service.location,
      address: service.address,
      notes: service.notes,
      price: Number(bundle.pricing?.amount || 0),
      priceStatus: bundle.pricing?.price_status || "PENDING",
      paymentStatus: bundle.payment?.payment_status || "NOT_APPLICABLE",
      workflowStatus: service.workflow_status,
      financeNotes: bundle.pricing?.finance_notes || "",
      pricedAt: bundle.pricing?.priced_at || null,
      pricedBy: bundle.pricing?.priced_by || null,
      receivedAt: bundle.payment?.received_at || null,
      receivedBy: bundle.payment?.received_by || null,
      paymentMethod: bundle.payment?.payment_method || "",
      paymentNotes: bundle.payment?.payment_notes || "",
      materials: bundle.materials || [],
      employeeIds: (bundle.employees || []).map((item) => item.id),
      employees: (bundle.employees || []).map(mapEmployee),
      client: mapClient(bundle.client),
      team: bundle.team || null,
      status: service.status,
      createdBy: service.created_by,
      createdAt: service.created_at,
      updatedAt: service.updated_at,
      startedAt: service.started_at,
      startedBy: service.started_by,
      startLocation: mapLocation(bundle.locations?.find((item) => item.stage === "start")),
      finishedAt: service.finished_at,
      finishedBy: service.finished_by,
      finalLocation: mapLocation(bundle.locations?.find((item) => item.stage === "finish")),
      clientSignature: bundle.signature ? {
        signerName: bundle.signature.signer_name,
        imageUrl: signatureUrl?.imageUrl || null,
        imageDataUrl: signatureUrl?.imageDataUrl || null,
        signedAt: bundle.signature.signed_at,
        serviceType: bundle.signature.service_type_snapshot,
        serviceCode: bundle.signature.service_code_snapshot
      } : null,
      servicePhotos: {
        before: await mapMedia(before, this.mediaUrlResolver),
        after: await mapMedia(after, this.mediaUrlResolver)
      },
      reportPreference: bundle.reportPreference || null,
      serviceUpdates: bundle.updates || [],
      cancelledAt: service.cancelled_at,
      sentToClientAt: service.sent_to_client_at,
      sentToClientBy: service.sent_to_client_by,
      sentToClientChannel: service.sent_to_client_channel
    };
  }
}

module.exports = { ServiceMapper, mapClient, mapEmployee, mapLocation, mapMedia };
