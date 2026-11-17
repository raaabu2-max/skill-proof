import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type ActivityDatum = {
  minute: string;
  edits: number;
  pastes: number;
  tests: number;
  focus: number;
  changes: number;
};

export default function ActivityChart({ data }: { data: ActivityDatum[] }) {
  return <ResponsiveContainer width="100%" height="100%">
    <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -20 }}>
      <CartesianGrid stroke="#edf1ed" strokeDasharray="3 3" />
      <XAxis dataKey="minute" tick={{ fontSize: 10, fill: "#829087" }} />
      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#829087" }} />
      <Tooltip />
      <Legend wrapperStyle={{ fontSize: 10 }} />
      <Bar dataKey="edits" name="Edits" fill="#4d8b60" radius={[4, 4, 0, 0]} />
      <Bar dataKey="pastes" name="Pastes" fill="#d59a4c" radius={[4, 4, 0, 0]} />
      <Bar dataKey="tests" name="Test attempts" fill="#5c83c3" radius={[4, 4, 0, 0]} />
      <Bar dataKey="focus" name="Focus changes" fill="#9b8cb4" radius={[4, 4, 0, 0]} />
      <Bar dataKey="changes" name="Requirement changes" fill="#c46b61" radius={[4, 4, 0, 0]} />
    </BarChart>
  </ResponsiveContainer>;
}
