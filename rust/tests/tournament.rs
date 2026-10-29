//! The native tournament: every profile sits in every seat in turn, and a run repeats exactly.

use motw::tournament::run;

#[test]
fn profiles_rotate_and_runs_repeat() {
    let list: Vec<String> = ["bot:lean=0.3,sim=0", "bot:lean=-0.3,sim=0", "bot:lean=-0.3,sim=0"].iter().map(|s| s.to_string()).collect();
    let a = run(3, 3, &list, &[], false, 2, &|_| {});
    let b = run(3, 3, &list, &[], false, 3, &|_| {});
    for g in 0..3 {
        assert_eq!(a[g].seats[0], list[g % 3]);
        assert_eq!((a[g].winners.clone(), a[g].island, a[g].moves), (b[g].winners.clone(), b[g].island, b[g].moves));
    }
}
