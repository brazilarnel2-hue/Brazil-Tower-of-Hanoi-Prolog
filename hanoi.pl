% Pagdugtong ng dalawang listahan
cat([], L, L).
cat([H|T], L, [H|R]) :- cat(T, L, R).

% hanoi(N, Mula, Patungo, Gitna, Galaw)
hanoi(0, _, _, _, []) :- !.
hanoi(N, From, To, Via, Moves) :-
    N1 is N - 1,
    hanoi(N1, From, Via, To, M1),
    hanoi(N1, Via, To, From, M2),
    cat(M1, [From-To|M2], Moves).