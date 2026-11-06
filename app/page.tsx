import { Inbox, type SampleInvoice } from "@/components/inbox";
import report from "@/data/eval-report.json";
import samples from "@/data/samples.json";

export default function Page() {
  return (
    <Inbox
      invoices={samples.invoices as unknown as SampleInvoice[]}
      simulated={samples.simulated}
      report={report}
    />
  );
}
