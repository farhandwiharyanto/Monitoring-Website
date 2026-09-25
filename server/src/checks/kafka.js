// Check Kafka lewat metadata cluster.
//
// Yang diperiksa adalah apa yang benar-benar menentukan "Kafka ini bisa
// dipakai": broker menjawab, dan — bila topiknya disebut — topik itu ada
// beserta partisinya punya leader. Partisi tanpa leader adalah keadaan yang
// khas Kafka: cluster-nya hidup, tapi produce/consume ke partisi itu gagal.
// Memeriksa koneksi TCP saja tidak akan pernah menangkapnya.
//
// Sengaja tidak memproduksi atau mengonsumsi pesan apa pun: monitor tidak boleh
// meninggalkan jejak di topik yang dipantaunya.

const configOf = (m) => (m.check_config && typeof m.check_config === "object" ? m.check_config : {});

// "a:9092, b:9092" -> ["a:9092", "b:9092"]
export function parseBrokers(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

// kafkajs mencetak peringatan sendiri ke stdout; dimatikan supaya log server
// tidak dipenuhi kabar dari monitor yang sedang gagal.
const SILENT = () => () => {};

export async function checkKafka(monitor) {
  const cfg = configOf(monitor);
  const brokers = parseBrokers(cfg.kafka_brokers || monitor.hostname);
  if (brokers.length === 0) return { ok: false, ms: 0, message: "Daftar broker belum diisi" };

  const timeoutSeconds = Math.min(Math.max(Number(monitor.timeout_seconds) || 10, 1), 120);
  const topic = String(cfg.kafka_topic || "").trim();
  const start = performance.now();
  let admin;

  try {
    const { Kafka } = await import("kafkajs");
    const kafka = new Kafka({
      clientId: "pulsewatch-monitor",
      brokers,
      ssl: cfg.kafka_ssl === true,
      connectionTimeout: timeoutSeconds * 1000,
      requestTimeout: timeoutSeconds * 1000,
      // Monitor tidak boleh mengulang sendiri: satu check harus mencerminkan
      // satu keadaan, dan retry-nya sudah diatur max_retries milik monitor.
      // initialRetryTime tetap diisi meski retries 0: tanpa itu kafkajs
      // menghitung jeda dari nilai kosong dan Node mencetak
      // TimeoutNegativeWarning ke log server tiap check.
      retry: { retries: 0, initialRetryTime: 100 },
      logCreator: SILENT,
    });

    admin = kafka.admin();
    await admin.connect();

    // Tanpa topik: cukup pastikan cluster menjawab dan sebutkan jumlah broker
    if (!topic) {
      const cluster = await admin.describeCluster();
      const ms = Math.round(performance.now() - start);
      return { ok: true, ms, message: `Kafka OK · ${cluster.brokers.length} broker` };
    }

    // Keberadaan topik diperiksa lewat listTopics, BUKAN dengan meminta
    // metadata topik itu: pada broker dengan auto.create.topics.enable, meminta
    // metadata topik yang belum ada justru membuatnya. Monitor tidak boleh
    // mengubah apa pun pada sistem yang dipantaunya.
    const daftar = await admin.listTopics();
    if (!daftar.includes(topic)) {
      return { ok: false, ms: Math.round(performance.now() - start), message: `Topik "${topic}" tidak ditemukan` };
    }

    const meta = await admin.fetchTopicMetadata({ topics: [topic] });
    const found = meta.topics.find((x) => x.name === topic);
    const ms = Math.round(performance.now() - start);
    if (!found) return { ok: false, ms, message: `Topik "${topic}" tidak ditemukan` };

    // leader = -1 berarti partisi itu sedang tanpa leader: cluster hidup, tapi
    // produce/consume ke partisi tersebut akan gagal.
    const tanpaLeader = found.partitions.filter((p) => p.leader === undefined || p.leader < 0).length;
    if (tanpaLeader) {
      return { ok: false, ms, message: `Topik "${topic}": ${tanpaLeader} dari ${found.partitions.length} partisi tanpa leader` };
    }
    return { ok: true, ms, message: `Kafka OK · topik "${topic}", ${found.partitions.length} partisi` };
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    return { ok: false, ms, message: tidyKafkaError(err) };
  } finally {
    // disconnect() bisa melempar bila koneksinya memang tidak pernah terbuka;
    // dibiarkan lewat, agar tidak menggantikan penyebab aslinya.
    await admin?.disconnect().catch(() => {});
  }
}

// kafkajs melampirkan daftar percobaan pada error-nya; yang berguna hanya
// kalimat pertamanya.
export function tidyKafkaError(err) {
  const text = String(err?.message || "gagal").split("\n")[0].trim();
  return (text || "gagal").slice(0, 300);
}
