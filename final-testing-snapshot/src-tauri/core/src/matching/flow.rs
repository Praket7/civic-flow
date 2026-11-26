//! Internal min-cost max-flow graph. Domain rules and explanations belong to the parent module.

use std::collections::VecDeque;

#[derive(Debug, Clone)]
struct Edge {
    to: usize,
    rev: usize,
    capacity: i32,
    original_capacity: i32,
    cost: i32,
}

#[derive(Debug, Clone)]
pub(super) struct Flow {
    graph: Vec<Vec<Edge>>,
}

impl Flow {
    pub(super) fn new(nodes: usize) -> Self {
        Self {
            graph: vec![Vec::new(); nodes],
        }
    }

    pub(super) fn add_edge(&mut self, from: usize, to: usize, capacity: i32, cost: i32) {
        let forward = Edge {
            to,
            rev: self.graph[to].len(),
            capacity,
            original_capacity: capacity,
            cost,
        };
        let reverse = Edge {
            to: from,
            rev: self.graph[from].len(),
            capacity: 0,
            original_capacity: 0,
            cost: -cost,
        };
        self.graph[from].push(forward);
        self.graph[to].push(reverse);
    }

    /// SPFA handles the negative edge costs a mandatory-role bonus produces.
    pub(super) fn min_cost_max_flow(&mut self, source: usize, sink: usize) -> (i32, i32) {
        let nodes = self.graph.len();
        let mut total_flow = 0;
        let mut total_cost: i32 = 0;

        loop {
            let mut distance = vec![i32::MAX; nodes];
            let mut in_queue = vec![false; nodes];
            let mut previous: Vec<Option<(usize, usize)>> = vec![None; nodes];
            let mut queue = VecDeque::new();

            distance[source] = 0;
            queue.push_back(source);
            in_queue[source] = true;

            while let Some(node) = queue.pop_front() {
                in_queue[node] = false;
                let Some(node_distance) = distance.get(node).copied() else {
                    continue;
                };
                if node_distance == i32::MAX {
                    continue;
                }
                for (edge_index, edge) in self.graph[node].iter().enumerate() {
                    if edge.capacity <= 0 {
                        continue;
                    }
                    let next = edge.to;
                    let candidate_distance = node_distance.saturating_add(edge.cost);
                    if candidate_distance < distance[next] {
                        distance[next] = candidate_distance;
                        previous[next] = Some((node, edge_index));
                        if !in_queue[next] {
                            in_queue[next] = true;
                            queue.push_back(next);
                        }
                    }
                }
            }

            if distance[sink] == i32::MAX {
                break;
            }

            let mut node = sink;
            while node != source {
                let (from, edge_index) = previous[node].expect("augmenting path is complete");
                let edge = &self.graph[from][edge_index];
                let reverse_index = edge.rev;
                let capacity = edge.capacity;
                self.graph[from][edge_index].capacity = capacity - 1;
                self.graph[node][reverse_index].capacity += 1;
                node = from;
            }

            total_flow += 1;
            total_cost = total_cost.saturating_add(distance[sink]);
        }

        (total_flow, total_cost)
    }

    pub(super) fn used_destinations(&self, from: usize) -> Vec<usize> {
        self.graph[from]
            .iter()
            .enumerate()
            .filter(|(_, edge)| edge.original_capacity == 1 && edge.capacity == 0)
            .map(|(_, edge)| edge.to)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::Flow;

    #[test]
    fn finds_the_cheapest_complete_assignment_with_negative_priority_costs() {
        let mut flow = Flow::new(6);
        flow.add_edge(0, 1, 1, 0);
        flow.add_edge(0, 2, 1, 0);
        flow.add_edge(1, 3, 1, 3);
        flow.add_edge(1, 4, 1, 6);
        flow.add_edge(2, 3, 1, 1);
        flow.add_edge(2, 4, 1, 0);
        flow.add_edge(3, 5, 1, -5);
        flow.add_edge(4, 5, 1, -5);

        assert_eq!(flow.min_cost_max_flow(0, 5), (2, -7));
        assert_eq!(flow.used_destinations(1), vec![3]);
        assert_eq!(flow.used_destinations(2), vec![4]);
    }

    #[test]
    fn never_uses_a_zero_capacity_edge() {
        let mut flow = Flow::new(3);
        flow.add_edge(0, 1, 0, -100);
        flow.add_edge(1, 2, 1, 0);
        assert_eq!(flow.min_cost_max_flow(0, 2), (0, 0));
        assert!(flow.used_destinations(0).is_empty());
    }
}
